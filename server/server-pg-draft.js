'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { URL } = require('url');
const cfg = require('./config');
const { Store } = require('./db');

// لا يُنشر هذا الإصدار على Render بالخطأ: بيانات الدعوات ما زالت محلية.
// أزل هذا الحاجز فقط بعد إكمال ربط PostgreSQL واختبار جميع الرحلات.
if (process.env.RENDER === 'true') {
  throw new Error('النشر على Render متوقف: قاعدة البيانات الدائمة لم تُربط بمسارات الموقع بعد.');
}
// نسخة اختبار منفصلة؛ لم تُعتمد للنشر.
const { PostgresStore, createPool } = require('./postgres-store');
const { PostgresAdmin } = require('./postgres-admin');
const pool = createPool(process.env.DATABASE_URL);
const db = new PostgresStore(pool);
const postgresAdmin = new PostgresAdmin(pool);
// التخزين السحابي اختياري ومخصص للخادم فقط. لا تفعّله للنشر حتى تُنقل قاعدة الدعوات.
const { SupabaseStorage } = require('./supabase-storage');
const cloudUrl = process.env.SUPABASE_URL || '';
const cloudKey = process.env.SUPABASE_SECRET_KEY || '';
if (!!cloudUrl !== !!cloudKey) throw new Error('يجب إعداد عنوان Supabase ومفتاحه معًا');
const cloudFiles = cloudUrl ? new SupabaseStorage({ url:cloudUrl, secretKey:cloudKey, bucket:process.env.SUPABASE_BUCKET || 'zaffa-private' }) : null;
const PUB = path.join(cfg.rootDir, 'public');

/* ============================ helpers ============================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function json(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  }, extra));
  res.end(body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw Object.assign(new Error('invalid json'), { code: 400 }); }
}

/* rate limit بسيط في الذاكرة */
const rl = new Map();
function rateLimit(ip, bucket, max = 20, windowMs = 60_000) {
  const k = bucket + ':' + ip;
  const now = Date.now();
  let e = rl.get(k);
  if (!e || now - e.t > windowMs) { e = { n: 0, t: now }; rl.set(k, e); }
  e.n++;
  if (e.n > max) return false;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rl) if (now - e.t > 120_000) rl.delete(k);
}, 120_000).unref();

/* جلسات إدارة خادمية: كلمة المرور لا تُخزّن إلا كتجزئة PBKDF2 مملّحة. */
const adminSessions = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;
async function readAdminAuth() {
  if (postgresAdmin) return postgresAdmin.read();
  try {
    const a = JSON.parse(fs.readFileSync(cfg.adminAuthFile, 'utf8'));
    if (typeof a.username !== 'string' || !/^[A-Za-z0-9_.-]{3,40}$/.test(a.username) ||
        !Number.isInteger(a.iterations) || a.iterations < 310000 || a.iterations > 2000000 ||
        !/^[0-9a-f]{32}$/i.test(a.salt || '') || !/^[0-9a-f]{64}$/i.test(a.digest || '')) return null;
    return a;
  } catch { return null; }
}
function hashPassword(password, a) {
  return new Promise((resolve, reject) => crypto.pbkdf2(password, Buffer.from(a.salt,'hex'), a.iterations, 32, 'sha256', (err, hash) => err ? reject(err) : resolve(hash)));
}
async function checkPassword(password, a) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const hash = await hashPassword(password, a), expected = Buffer.from(a.digest, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
function sessionCookie(req, value, maxAge) {
  let secure = cfg.publicUrl.startsWith('https://');
  try { if (req.headers.origin && new URL(req.headers.origin).protocol === 'https:') secure = true; } catch (_) {}
  // معاينة Arena داخل إطار من موقع آخر: ملفات الارتباط Strict لا تُرسل فيه.
  // Partitioned يعزل جلسة المعاينة عن المواقع الأخرى؛ النشر العادي يبقى Strict.
  const embeddedPreview = process.env.E2B_SANDBOX === 'true' && secure;
  const sameSite = embeddedPreview ? 'None' : 'Strict';
  return `zaffa_admin_session=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}${embeddedPreview ? '; Partitioned' : ''}`;
}
async function getAdminSession(req) {
  const raw = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('zaffa_admin_session='));
  // احتياطي للمعاينة المضمنة فقط عند حظر المتصفح ملفات الارتباط.
  const token = (process.env.E2B_SANDBOX === 'true' && req.headers['x-admin-preview-session']) || (raw ? raw.slice('zaffa_admin_session='.length) : '');
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const session = adminSessions.get(token), a = await readAdminAuth();
  if (!session || session.expires <= Date.now() || !a || session.fingerprint !== a.digest) { adminSessions.delete(token); return null; }
  return {token, ...session};
}
async function requireAdmin(req, res, csrf = false) {
  const s = await getAdminSession(req);
  if (!s) { json(res, 401, {error:'سجّل الدخول إلى لوحة الإدارة'}); return null; }
  if (csrf && req.headers['x-csrf-token'] !== s.csrf) { json(res, 403, {error:'تعذّر التحقق من الجلسة'}); return null; }
  return s;
}
setInterval(() => { const now=Date.now(); for (const [id,s] of adminSessions) if (s.expires <= now) adminSessions.delete(id); }, 60000).unref();

/* ============================ Stripe ============================ */
async function stripeReq(endpoint, form) {
  const res = await fetch('https://api.stripe.com/v1/' + endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + cfg.stripeKey,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || 'stripe error ' + res.status);
  return j;
}

/* ============================ pricing ============================ */
async function priceInfo() {
  const sold = await db.sold();
  return {
    amount: cfg.price.card,
    addon: cfg.price.addon,
    addonRegular: cfg.price.addonRegular,
    currency: cfg.price.currency,
    sold,
    demoMode: cfg.demoMode,
    demoCheckoutEnabled: cfg.demoMode && cfg.allowDemoCheckout,
    cardAvailable: !cfg.demoMode && !!cfg.stripeWebhookSecret,
    sd: cfg.sd.account ? {
      price: cfg.sd.price, addon: cfg.sd.addon, currency: cfg.sd.currency,
      name: cfg.sd.name, account: cfg.sd.account, whatsapp: cfg.sd.whatsapp,
      methods: [{id:'bankak',name:'بنكك',account:cfg.sd.account}, {id:'fawry',name:'فوري',account:cfg.sd.fawry}, {id:'ocash',name:'أوكاش',account:cfg.sd.ocash}].filter(m => m.account),
    } : null,
  };
}

/* ============================ themes ============================ */
const THEMES = {
  garden: {
    name: 'حديقة الورود',
    accent: '#c9798c', deep: '#7d2f47', soft: '#fdeef2',
    gold: ['#e8b8c4', '#c9798c', '#9c4a63'],
    hero: '/assets/hero/garden.webp',
    phrase: 'بين الورد والفرح، ندعوكم لمشاركتنا حفل زفافنا',
  },
  saudi: {
    name: 'القاعة السعودية',
    accent: '#b8912f', deep: '#4a3a1a', soft: '#fdf7e8',
    gold: ['#e2c274', '#b8912f', '#8a6a1c'],
    hero: '/assets/hero/saudi.webp',
    phrase: 'بكل سرور نتشرّف بدعوتكم لحضور حفل زواجنا',
  },
  crystal: {
    name: 'قاعة الكريستال',
    accent: '#7c8794', deep: '#2b333d', soft: '#f2f5f8',
    gold: ['#c3ccd6', '#8e99a5', '#5f6873'],
    hero: '/assets/hero/crystal.webp',
    phrase: 'في أمسيةٍ مضيئة، يسعدنا أن تشاركونا حفل زفافنا',
  },
  'henna-groom': {
    name: 'حنة العريس',
    accent: '#b9985e', deep: '#4b101c', soft: '#fff7eb',
    gold: ['#f1dbab', '#c69d61', '#8b6a34'],
    hero: '/assets/hero/henna-groom.webp',
    phrase: 'يا مرحب بالأحباب في ليلة حنة العريس',
    side: 'm',
  },
  jirtig: {
    name: 'ليلة الجرتق',
    accent: '#a92c2e', deep: '#591c22', soft: '#fff8ed',
    gold: ['#e2c27f', '#aa3033', '#7a2526'],
    hero: '/assets/hero/jirtig.webp',
    phrase: 'على محبة الأهل ولمّة الأحباب، ندعوكم إلى ليلة الجرتق',
  },
  sudan: {
    name: 'الجرتق السوداني',
    accent: '#b5642e', deep: '#5a2a12', soft: '#fdf1e6',
    gold: ['#e0a662', '#b5642e', '#8a4520'],
    hero: '/assets/hero/sudan.webp',
    phrase: 'بفرحة سودانية أصيلة، ندعوكم لمشاركتنا ليلة الجرتق',
  },
  'saudi-m': {
    name: 'حفل الرجال',
    accent: '#b8912f', deep: '#3a2f14', soft: '#fbf6e9',
    gold: ['#e2c274', '#b8912f', '#8a6a1c'],
    hero: '/assets/hero/men.webp',
    phrase: 'بكل اعتزاز، نتشرّف بدعوتكم لحضور حفل الزواج',
    side: 'm',
  },
  'levant': {
    name: 'قاعة الشام',
    accent: '#3f7d6e', deep: '#1e4438', soft: '#eef7f3',
    gold: ['#c8dfc9', '#3f7d6e', '#245a4a'],
    hero: '/assets/hero/levant.webp',
    phrase: 'بمحبةٍ كبيرة، ندعوكم لمشاركتنا فرحة زفافنا',
  },
  'saudi-w': {
    name: 'حفل النساء',
    accent: '#c9798c', deep: '#7d2f47', soft: '#fdeef2',
    gold: ['#e8b8c4', '#c9798c', '#9c4a63'],
    hero: '/assets/hero/women.webp',
    phrase: 'بكل محبة، يسعدنا دعوتكنّ لمشاركتنا حفل الزفاف',
    side: 'w',
  },
  /* ---------- هويات مستوحاة من تصاميم عربية معاصرة ---------- */
  ivory: {
    name: 'العاج الملكي',
    accent: '#a8802f', deep: '#4a3c24', soft: '#fbf6ec',
    gold: ['#dcbc76', '#a8802f', '#7a5a1c'],
    hero: '/assets/hero/ivory.webp',
    phrase: 'بكل محبة، نتشرّف بدعوتكم لمشاركتنا حفل زفافنا',
  },
  velvet: {
    name: 'المخمل العنّابي',
    accent: '#a8324a', deep: '#4a0d18', soft: '#fdf0f2',
    gold: ['#d9a4a4', '#a8324a', '#6d1424'],
    hero: '/assets/hero/velvet.webp',
    phrase: 'في ليلةٍ تليق بالمحبة، ندعوكم لمشاركتنا فرحة زفافنا',
  },
  thuluth: {
    name: 'الذهب والليل',
    accent: '#c9a227', deep: '#1a1608', soft: '#faf6e8',
    gold: ['#e8cf7a', '#c9a227', '#8a6c10'],
    hero: '/assets/hero/thuluth.webp',
    phrase: 'بأجمل عبارات الود، نتشرّف بدعوتكم لحفل زفافنا',
  },
  sunset: {
    name: 'غروب المدينة',
    accent: '#c2547e', deep: '#3d1f45', soft: '#fdf1f6',
    gold: ['#e8a0bd', '#c2547e', '#8a3358'],
    hero: '/assets/hero/sunset.webp',
    phrase: 'بألوان الفرح، ندعوكم لمشاركتنا حفل زفافنا',
  },
  blossom: {
    name: 'زهر الياسمين',
    accent: '#6b8fb5', deep: '#2b4157', soft: '#f2f7fb',
    gold: ['#a9c3d9', '#6b8fb5', '#456b8f'],
    hero: '/assets/hero/blossom.webp',
    phrase: 'كما يتفتح الزهر، تبدأ حكايتنا بحضوركم',
  },
  marble: {
    name: 'رخام وذهب',
    accent: '#9a8149', deep: '#332c1e', soft: '#faf8f4',
    gold: ['#d4c08a', '#9a8149', '#6b5a30'],
    hero: '/assets/hero/marble.webp',
    phrase: 'بكل ودّ، ندعوكم للاحتفاء معنا بحفل زفافنا',
  },
  emerald: {
    name: 'الزمرد الملكي',
    accent: '#1f6b52', deep: '#0d3327', soft: '#eef7f3',
    gold: ['#c9b872', '#1f6b52', '#0f4a37'],
    hero: '/assets/hero/emerald.webp',
    phrase: 'بفرحٍ يليق بكم، نتشرّف بدعوتكم لحفل زفافنا',
  },
  terracotta: {
    name: 'الطين والسنبلة',
    accent: '#b26237', deep: '#4a2412', soft: '#fdf3ec',
    gold: ['#dda070', '#b26237', '#82421f'],
    hero: '/assets/hero/terracotta.webp',
    phrase: 'من دفء اللمة، ندعوكم لمشاركتنا حفل زفافنا',
  },
  linen: {
    name: 'الكتّان الهادئ',
    accent: '#8a7a63', deep: '#3d362b', soft: '#f8f5ef',
    gold: ['#c4b49c', '#8a7a63', '#5f5445'],
    hero: '/assets/hero/linen.webp',
    phrase: 'بكل بساطة ومحبة، ندعوكم لمشاركتنا حفل زفافنا',
  },
  lantern: {
    name: 'فانوس الليل',
    accent: '#c99a3f', deep: '#101d33', soft: '#f4f7fb',
    gold: ['#e6c583', '#c99a3f', '#8a6a22'],
    hero: '/assets/hero/lantern.webp',
    phrase: 'بنور المحبة، ندعوكم لمشاركتنا حفل زفافنا',
  },
};

/* ============================ OG image ============================ */
/* الأولوية: صورة PNG مولّدة في المتصفح (تشكيل عربي صحيح 100%).
   إن لم توجد، نولّد بديلًا من SVG. */
function ogImagePath(inv) {
  return path.join(cfg.dataDir, 'og', inv.id + '.png');
}

function ogFallbackSvg(inv) {
  const theme = THEMES[inv.template] || THEMES.garden;
  const d = inv.data;
  const g = esc(d.groom || 'العريس'), b = esc(d.bride || 'العروس');
  const venue = esc(d.venue || '');
  let dateTxt = '';
  const m = String(d.date || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const ar = n => String(n).replace(/\d/g, x => '٠١٢٣٤٥٦٧٨٩'[x]);
    dateTxt = `${ar(+m[3])} ${months[+m[2] - 1]} ${ar(m[1])}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${theme.soft}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="${theme.gold[0]}"/><stop offset=".5" stop-color="${theme.gold[1]}"/><stop offset="1" stop-color="${theme.gold[2]}"/>
</linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="url(#gold)" stroke-width="3" opacity=".55"/>
<text x="600" y="150" text-anchor="middle" font-family="Amiri,serif" font-size="34" fill="${theme.deep}" opacity=".75">بسم الله الرحمن الرحيم</text>
<text x="600" y="215" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="26" fill="${theme.accent}">${esc(theme.phrase)}</text>
<text x="600" y="355" text-anchor="middle" font-family="Amiri,serif" font-size="90" font-weight="700" fill="${theme.deep}">${g}</text>
<text x="600" y="415" text-anchor="middle" font-family="Amiri,serif" font-size="42" fill="${theme.gold[1]}">و</text>
<text x="600" y="500" text-anchor="middle" font-family="Amiri,serif" font-size="90" font-weight="700" fill="${theme.deep}">${b}</text>
<line x1="420" y1="540" x2="560" y2="540" stroke="${theme.gold[1]}" stroke-width="2" opacity=".7"/>
<line x1="640" y1="540" x2="780" y2="540" stroke="${theme.gold[1]}" stroke-width="2" opacity=".7"/>
<text x="600" y="558" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="28" fill="${theme.accent}">${dateTxt}</text>
<text x="600" y="594" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="22" fill="${theme.deep}" opacity=".6">${venue}</text>
</svg>`;
}

/* ============================ render invite ============================ */
function renderInvite(inv) {
  const tpl = fs.readFileSync(path.join(PUB, 'invite.html'), 'utf8');
  const theme = THEMES[inv.template] || THEMES.garden;
  const payload = Object.assign({}, inv.data, {
    id: inv.id,
    template: inv.template,
    theme: {
      accent: theme.accent, deep: theme.deep, soft: theme.soft,
      id: inv.template,
      gold: theme.gold, hero: theme.hero, phrase: theme.phrase,
      side: theme.side || '',
    },
  });
  // منع كسر السكربت
  const safe = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const ogUrl = `${cfg.publicUrl}/og/${inv.id}.png`;
  const page = tpl
    .replace('__OG_IMAGE__', ogUrl)
    .replace('/*__INVITE__*/null', safe)
    .replace(/__THEME_ACCENT__/g, theme.accent)
    .replace(/__THEME_DEEP__/g, theme.deep)
    .replace(/__THEME_SOFT__/g, theme.soft)
    .replace(/__TITLE__/g, esc(`${theme.side === 'm' ? (inv.data.groom || 'العريس') : theme.side === 'w' ? (inv.data.bride || 'العروس') : `${inv.data.groom || 'العريس'} و ${inv.data.bride || 'العروس'}`} — ${inv.template === 'henna-groom' ? 'دعوة حنة العريس' : 'دعوة زفاف'}`));
  return page;
}

/* ============================ OG image (SVG) ============================ */
function ogSvg(inv) {
  const theme = THEMES[inv.template] || THEMES.garden;
  const d = inv.data;
  const g = esc(d.groom || 'العريس'), b = esc(d.bride || 'العروس');
  const venue = esc(d.venue || '');
  let dateTxt = '';
  const m = String(d.date || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    dateTxt = `${+m[3]} ${months[+m[2] - 1]} ${m[1]}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${theme.soft}"/><stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${theme.gold[0]}"/><stop offset=".5" stop-color="${theme.gold[1]}"/><stop offset="1" stop-color="${theme.gold[2]}"/>
  </linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="url(#gold)" stroke-width="3" opacity=".55"/>
<text x="600" y="150" text-anchor="middle" font-family="Amiri,serif" font-size="34" fill="${theme.deep}" opacity=".75">بسم الله الرحمن الرحيم</text>
<text x="600" y="215" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="26" fill="${theme.accent}" letter-spacing="1">${esc(theme.phrase)}</text>
<text x="600" y="350" text-anchor="middle" font-family="Amiri,serif" font-size="86" font-weight="700" fill="${theme.deep}">${g}</text>
<text x="600" y="410" text-anchor="middle" font-family="Amiri,serif" font-size="40" fill="${theme.gold[1]}">و</text>
<text x="600" y="490" text-anchor="middle" font-family="Amiri,serif" font-size="86" font-weight="700" fill="${theme.deep}">${b}</text>
<line x1="420" y1="530" x2="560" y2="530" stroke="${theme.gold[1]}" stroke-width="2" opacity=".7"/>
<line x1="640" y1="530" x2="780" y2="530" stroke="${theme.gold[1]}" stroke-width="2" opacity=".7"/>
<text x="600" y="546" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="28" fill="${theme.accent}">${esc(dateTxt)}</text>
<text x="600" y="586" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="22" fill="${theme.deep}" opacity=".6">${venue}</text>
</svg>`;
}

/* ============================ static ============================ */
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/' || p === '') p = '/index.html';
  const aliases = { '/create': '/create.html', '/dashboard': '/dashboard.html', '/done': '/done.html', '/admin': '/admin.html' };
  if (aliases[p]) p = aliases[p];
  const file = path.join(PUB, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const isAsset = /^\/(assets|fonts)\//.test(p);

    /* ETag من حجم الملف وتاريخ تعديله — يجعل المتصفح يتحقّق بدل أن يخدم نسخة قديمة */
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' });
      return res.end();
    }

    res.writeHead(200, {
      'content-type': type,
      'content-length': st.size,
      etag,
      'last-modified': st.mtime.toUTCString(),
      /* no-cache = يُخزَّن لكن يُعاد التحقّق منه دائمًا (يمنع الألوان القديمة) */
      'cache-control': isAsset
        ? 'no-cache, must-revalidate'
        : 'no-cache, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ============================ router ============================ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname.replace(/\/+$/, '') || '/';
  // لا نثق في ترويسات العميل إلا من وسيط محدد صراحةً. آخر عنوان أضافه الوسيط هو عنوان الاتصال السابق.
  const peer = (req.socket.remoteAddress || 'x').replace(/^::ffff:/, '');
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim().replace(/^::ffff:/, '');
  const ip = cfg.trustedProxyIps.includes(peer) && net.isIP(forwarded) ? forwarded : peer;

  try {
    /* حساب المدير */
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (!rateLimit(ip, 'admin-login', 8, 60000)) return json(res, 429, {error:'محاولات كثيرة، حاول بعد دقيقة'});
      const a = await readAdminAuth();
      if (!a) return json(res, 503, {error:'حساب الإدارة غير مهيأ؛ تواصل مع مسؤول الخادم'});
      const body = await readJson(req);
      const match = await checkPassword(body.password, a);
      if (String(body.username || '') !== a.username || !match) return json(res, 401, {error:'اسم المستخدم أو كلمة المرور غير صحيحة'});
      if (adminSessions.size >= 1000) return json(res, 503, {error:'حاول مرة أخرى لاحقًا'});
      const old = await getAdminSession(req); if (old) adminSessions.delete(old.token);
      const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex');
      adminSessions.set(token, {csrf, expires: Date.now() + SESSION_MS, fingerprint: a.digest});
      // الرمز الاحتياطي للمعاينة يُحفظ في ذاكرة الصفحة فقط، وليس في التخزين الدائم.
      const preview = process.env.E2B_SANDBOX === 'true';
      return json(res, 200, {ok:true, csrf, ...(preview ? {previewToken:token} : {})}, {'set-cookie':sessionCookie(req, token, SESSION_MS/1000)});
    }
    if (p === '/api/admin/session' && req.method === 'GET') {
      const s = await requireAdmin(req, res); if (!s) return;
      return json(res, 200, {ok:true, csrf:s.csrf});
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      const s = await requireAdmin(req, res, true); if (!s) return;
      adminSessions.delete(s.token);
      return json(res, 200, {ok:true}, {'set-cookie':sessionCookie(req, '', 0)});
    }
    if (p === '/api/admin/password' && req.method === 'POST') {
      const s = await requireAdmin(req, res, true); if (!s) return;
      if (!rateLimit(ip, 'admin-password', 5, 60000)) return json(res, 429, {error:'محاولات كثيرة، حاول بعد دقيقة'});
      const body = await readJson(req), a = await readAdminAuth();
      if (!a || !(await checkPassword(body.currentPassword, a))) return json(res, 403, {error:'كلمة المرور الحالية غير صحيحة'});
      if (typeof body.newPassword !== 'string' || body.newPassword.length < 12 || body.newPassword.length > 200)
        return json(res, 400, {error:'كلمة المرور الجديدة يجب أن تكون من ١٢ إلى ٢٠٠ حرف'});
      if (postgresAdmin) {
        if (!(await postgresAdmin.changePassword(body.currentPassword, body.newPassword))) return json(res, 409, {error:'تغيرت كلمة المرور؛ أعد تسجيل الدخول'});
      } else {
        const updated = {username:a.username, iterations:310000, salt:crypto.randomBytes(16).toString('hex')};
        updated.digest = (await hashPassword(body.newPassword, updated)).toString('hex');
        const tmp = cfg.adminAuthFile + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        try { fs.writeFileSync(tmp, JSON.stringify(updated), {mode:0o600}); fs.renameSync(tmp, cfg.adminAuthFile); }
        finally { try { fs.unlinkSync(tmp); } catch (_) {} }
      }
      adminSessions.clear();
      return json(res, 200, {ok:true}, {'set-cookie':sessionCookie(req, '', 0)});
    }

    /* ---------- STATS ---------- */
    if (p === '/api/stats' && req.method === 'GET') {
      return json(res, 200, await priceInfo());
    }

    /* ---------- CREATE ---------- */
    if (p === '/api/invites' && req.method === 'POST') {
      if (!rateLimit(ip, 'create', 15)) return json(res, 429, { error: 'محاولات كثيرة، حاول بعد قليل' });
      const body = await readJson(req);
      const chosenTheme = THEMES[body.template] || THEMES.garden;
      if (!body.data || (chosenTheme.side !== 'w' && !String(body.data.groom || '').trim()) || (chosenTheme.side !== 'm' && !String(body.data.bride || '').trim())) {
        return json(res, 400, { error: 'الأسماء مطلوبة' });
      }
      if (body.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(body.email)) {
        return json(res, 400, { error: 'بريد إلكتروني غير صحيح' });
      }
      const inv = await db.createInvite({ data: body.data, email: body.email, template: body.template });
      return json(res, 201, { id: inv.id, k: inv.key, status: inv.status, referenceNumber: inv.referenceNumber });
    }

    /* ---------- INVITE ROUTES ---------- */
    let m = p.match(/^\/api\/invites\/([a-z0-9]+)(\/.*)?$/);
    if (m) {
      const id = m[1], sub = m[2] || '';
      const inv = await db.get(id);
      if (!inv) return json(res, 404, { error: 'not found' });
      // ردود الضيوف والتهاني غير متاحة حتى التفعيل، حتى عند استدعاء الـ API مباشرة.
      if (inv.status !== 'active' && ((sub === '/rsvp' && req.method === 'POST') ||
          (sub === '/wishes' && (req.method === 'GET' || req.method === 'POST')))) {
        return json(res, 403, { error: 'الدعوة غير مفعّلة بعد' });
      }

      /* GET /api/invites/:id?k= */
      if (!sub && req.method === 'GET') {
        const k = u.searchParams.get('k');
        if (k !== inv.key) return json(res, 403, { error: 'forbidden' });
        return json(res, 200, {
          id: inv.id, referenceNumber: inv.referenceNumber, status: inv.status, template: inv.template,
          data: inv.data, email: inv.email, addon: inv.addon,
        });
      }

      /* PUT /api/invites/:id */
      if (!sub && (req.method === 'PUT' || req.method === 'PATCH')) {
        if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
        const body = await readJson(req);
        const changed = await db.updateInvite(id, current => {
          if (body.data) current.data = body.data;
          if (body.template && current.status !== 'active') current.template = body.template;
          if (typeof body.addon === 'boolean') current.addon = body.addon;
          return current;
        });
        return json(res, 200, { ok: true, status: changed.status });
      }

      /* موسيقى مخصصة لكل دعوة: الرفع محمي بمفتاح التعديل، والاستماع متاح للضيوف */
      if (sub === '/music' && req.method === 'POST') {
        if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
        if (!rateLimit(ip, 'music:' + id, 15)) return json(res, 429, { error: 'محاولات كثيرة' });
        const max = 8 * 1024 * 1024;
        if (Number(req.headers['content-length'] || 0) > max) return json(res, 413, { error: 'حجم الموسيقى أكبر من ٨ ميغابايت' });
        const raw = await readBody(req, max);
        const valid = raw.length > 128 && (raw.subarray(0, 3).toString('ascii') === 'ID3' ||
          (raw[0] === 0xff && (raw[1] & 0xe0) === 0xe0 && (raw[1] & 0x18) !== 0x08 && (raw[1] & 0x06) !== 0));
        if (!valid) return json(res, 400, { error: 'الملف ليس MP3 صالحًا' });
        if (cloudFiles) await cloudFiles.put('music', id, raw);
        else {
          const dir = path.join(cfg.dataDir, 'music');
          fs.mkdirSync(dir, { recursive:true });
          const file = path.join(dir, id + '.mp3');
          const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
          try { fs.writeFileSync(tmp, raw); fs.renameSync(tmp, file); }
          finally { try { fs.unlinkSync(tmp); } catch (_) {} }
        }
        return json(res, 200, { ok: true });
      }
      if (sub === '/music' && req.method === 'GET') {
        if (inv.status !== 'active' && req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'الدعوة غير مفعّلة بعد' });
        if (cloudFiles) {
          const bytes = await cloudFiles.get('music', id);
          if (!bytes) return json(res, 404, { error: 'لا توجد موسيقى مرفوعة' });
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(bytes);
        }
        const file = path.join(cfg.dataDir, 'music', id + '.mp3');
        if (!fs.existsSync(file)) return json(res, 404, { error: 'لا توجد موسيقى مرفوعة' });
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': fs.statSync(file).size,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return fs.createReadStream(file).pipe(res);
      }

      /* POST /api/invites/:id/rsvp  (عام) */
      if (sub === '/rsvp' && req.method === 'POST') {
        if (!rateLimit(ip, 'rsvp:' + id, 30)) return json(res, 429, { error: 'محاولات كثيرة' });
        const b = await readJson(req);
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) return json(res, 400, { error: 'الاسم مطلوب' });
        const guests = Math.max(1, Math.min(10, parseInt(b.guests, 10) || 1));
        const fields = { name, guests, attending: !!b.attending,
          note: String(b.note || '').slice(0, 300),
          side: (b.side === 'm' || b.side === 'w') ? b.side : '' };
        if (b.responseId || b.editToken) {
          const hash = crypto.createHash('sha256').update(String(b.editToken || '')).digest('hex');
          const row = await db.updateGuestRow('rsvp',id,b.responseId,r => r.editTokenHash === hash ? {...r,...fields} : null,true);
          if (!row) return json(res, 403, { error: 'تعذر تعديل الرد' });
          return json(res, 200, { ok: true, id: row.id });
        }
        const editToken = crypto.randomBytes(32).toString('hex');
        const row = await db.addGuestRow('rsvp',id,{ ...fields,
          editTokenHash: crypto.createHash('sha256').update(editToken).digest('hex') });
        if (!row) return json(res, 403, {error:'الدعوة غير مفعّلة بعد'});
        return json(res, 201, { ok: true, id: row.id, editToken });
      }

      /* GET|POST /api/invites/:id/wishes */
      if (sub === '/wishes' && req.method === 'GET') {
        const list = (await db.listRows('wish',id)).filter(w=>!w.hidden).map(w => ({ id: w.id, name: w.name, message: w.message, createdAt: w.createdAt }));
        return json(res, 200, { wishes: list });
      }
      if (sub === '/wishes' && req.method === 'POST') {
        if (!rateLimit(ip, 'wish:' + id, 20)) return json(res, 429, { error: 'محاولات كثيرة' });
        const b = await readJson(req);
        const name = String(b.name || '').trim().slice(0, 60);
        const message = String(b.message || '').trim().slice(0, 300);
        if (!name || !message) return json(res, 400, { error: 'الاسم والرسالة مطلوبان' });
        const row = await db.addGuestRow('wish',id,{ name, message });
        if (!row) return json(res, 403, {error:'الدعوة غير مفعّلة بعد'});
        return json(res, 201, { ok: true, id: row.id });
      }

      /* DELETE /api/invites/:id/wishes/:wid */
      let mw = sub.match(/^\/wishes\/([a-z0-9]+)$/);
      if (mw && req.method === 'DELETE') {
        if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
        const w = await db.updateGuestRow('wish',id,mw[1],row=>({...row,hidden:true}));
        if (!w) return json(res, 404, { error: 'not found' });
        return json(res, 200, { ok: true });
      }

      if (mw && req.method === 'PATCH') {
        if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
        const w = await db.updateGuestRow('wish',id,mw[1],row=>({...row,hidden:false}));
        if (!w) return json(res, 404, { error: 'not found' });
        return json(res, 200, { ok: true });
      }

      /* POST /api/invites/:id/og  — رفع صورة المشاركة PNG من المتصفح */
      if (sub === '/og' && req.method === 'POST') {
        if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
        const raw = await readBody(req, 4_000_000);
        // تحقق من توقيع PNG
        const isPng = raw.length > 8 && raw[0] === 0x89 && raw[1] === 0x50 &&
                      raw[2] === 0x4e && raw[3] === 0x47;
        if (!isPng) return json(res, 400, { error: 'الصورة يجب أن تكون PNG' });
        if (cloudFiles) await cloudFiles.put('og', inv.id, raw);
        else {
          const dir = path.join(cfg.dataDir, 'og');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, inv.id + '.png');
          const tmp = file + '.tmp';
          fs.writeFileSync(tmp, raw);
          fs.renameSync(tmp, file);
        }
        const updated = await db.updateInvite(id,current=>({...current,ogVersion:(current.ogVersion||0)+1}));
        return json(res, 200, { ok: true, bytes: raw.length, version: updated.ogVersion });
      }

      /* GET /api/invites/:id/dashboard?k= */
      if (sub === '/dashboard' && req.method === 'GET') {
        if (u.searchParams.get('k') !== inv.key) return json(res, 403, { error: 'forbidden' });
        const rs = await db.listRows('rsvp',id);
        const yes = rs.filter(r => r.attending);
        const no = rs.filter(r => !r.attending);
        const guests = yes.reduce((s, r) => s + (r.guests || 1), 0);
        return json(res, 200, {
          referenceNumber: inv.referenceNumber, status: inv.status, template: inv.template, data: inv.data, addon: inv.addon,
          stats: { responses: rs.length, coming: yes.length, declined: no.length, guests },
          rsvps: rs.map(({ editTokenHash, ...r }) => r).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          wishes: (await db.listRows('wish',id)).map(w => ({ id: w.id, name: w.name, message: w.message, hidden: w.hidden, createdAt: w.createdAt })),
        });
      }

      /* GET /api/invites/:id/guests.csv?k= */
      if (sub === '/guests.csv' && req.method === 'GET') {
        if (u.searchParams.get('k') !== inv.key) return json(res, 403, { error: 'forbidden' });
        const rows = [['الاسم', 'الحضور', 'المرافقون', 'ملاحظة', 'الوقت']];
        for (const r of await db.listRows('rsvp',id)) {
          rows.push([r.name, r.attending ? 'حاضر' : 'معتذر', String(r.guests), r.note || '', r.createdAt]);
        }
        // تحييد صيغ برامج الجداول في مدخلات الضيوف قبل إضافة علامات CSV.
        const csvCell = value => {
          let text = String(value);
          if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
          return '"' + text.replace(/"/g, '""') + '"';
        };
        const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        return json(res, 200, { csv });
      }

      /* POST /api/invites/:id/activate (admin only) */
      if (sub === '/activate' && req.method === 'POST') {
        if (!await requireAdmin(req, res, true)) return;
        const activated=await db.activate(inv.id);
        return json(res, 200, { ok: true, status: activated.status });
      }
    }

    /* ---------- CHECKOUT ---------- */
    if (p === '/api/checkout' && req.method === 'POST') {
      const b = await readJson(req);
      const inv = await db.get(b.id);
      if (!inv || b.k !== inv.key) return json(res, 403, { error: 'forbidden' });
      if (inv.status === 'active' && !b.addonUpgrade) return json(res, 200, { alreadyActive: true });

      const pr = await priceInfo();
      const upgrading = inv.status === 'active' && b.addonUpgrade;
      const base = upgrading ? pr.addon : pr.amount;

      if (cfg.demoMode) {
        if (!cfg.allowDemoCheckout) return json(res, 503, { error: 'الدفع بالبطاقة غير متاح حاليًا، اختر التحويل المحلي' });
        // وضع تجريبي صريح، لا يُستخدم مع المدفوعات الحقيقية
        await db.activate(inv.id,{addon:!!upgrading});
        return json(res, 200, {
          demo: true,
          url: `${cfg.publicUrl}/done?id=${inv.id}&k=${inv.key}&demo=1`,
        });
      }

      if (!cfg.stripeWebhookSecret) return json(res, 503, { error: 'إعدادات تأكيد الدفع غير مكتملة، تواصل مع الإدارة' });
      const form = {
        mode: 'payment',
        success_url: `${cfg.publicUrl}/done?id=${inv.id}&k=${inv.key}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${cfg.publicUrl}/create?id=${inv.id}&k=${inv.key}&canceled=1`,
        client_reference_id: inv.id,
        customer_email: inv.email || undefined,
        'metadata[invite_id]': inv.id,
        'metadata[upgrading]': upgrading ? '1' : '0',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': pr.currency,
        'line_items[0][price_data][unit_amount]': String(base),
        'line_items[0][price_data][product_data][name]': upgrading ? 'إضافة دعوات الرجال والنساء — زَفّة' : 'دعوة زفاف إلكترونية — زَفّة',
      };
      const sess = await stripeReq('checkout/sessions', form);
      await db.updateInvite(inv.id,current=>({...current,stripeSessionId:sess.id}));
      return json(res, 200, { url: sess.url, id: sess.id });
    }

    /* ---------- VERIFY ---------- */
    if (p === '/api/verify' && req.method === 'GET') {
      const sid = u.searchParams.get('session_id');
      const id = u.searchParams.get('id');
      const inv = await db.get(id);
      if (!inv) return json(res, 404, { error: 'not found' });
      if (req.headers['x-edit-key'] !== inv.key) return json(res, 403, { error: 'forbidden' });
      if (inv.status === 'active') return json(res, 200, { status: 'active' });
      if (cfg.demoMode) return json(res, 200, { status: inv.status });
      if (!sid) return json(res, 400, { error: 'session_id مطلوب' });
      if (sid !== inv.stripeSessionId) return json(res, 403, { error: 'جلسة الدفع لا تطابق الدعوة' });
      const sess = await stripeGet('checkout/sessions/' + encodeURIComponent(sid));
      if (sess && sess.id === sid && sess.client_reference_id === inv.id && sess.payment_status === 'paid') {
        await db.activate(inv.id,{addon:!!(sess.metadata && sess.metadata.upgrading === '1')});
        return json(res, 200, { status: 'active' });
      }
      return json(res, 200, { status: inv.status, payment_status: sess && sess.payment_status });
    }

    /* ---------- WEBHOOK ---------- */
    if (p === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      if (!cfg.stripeWebhookSecret) return json(res, 503, { error: 'webhook not configured' });
      if (!verifyStripeSig(raw, req.headers['stripe-signature'] || '', cfg.stripeWebhookSecret)) return json(res, 400, { error: 'bad signature' });
      let evt = {};
      try { evt = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'bad json' }); }
      if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
        const s = evt.data && evt.data.object || {};
        const inv = await db.get(s.client_reference_id || (s.metadata && s.metadata.invite_id));
        if (inv && s.id === inv.stripeSessionId && s.payment_status === 'paid') {
          await db.activate(inv.id,{addon:!!(s.metadata && s.metadata.upgrading === '1')});
        }
      }
      return json(res, 200, { received: true });
    }

    /* ---------- BANKAK ---------- */
    if (p === '/api/bankak' && req.method === 'POST') {
      if (!rateLimit(ip, 'bankak', 10)) return json(res, 429, { error: 'محاولات كثيرة' });
      const b = await readJson(req);
      const inv = await db.get(b.id);
      if (!inv || b.k !== inv.key) return json(res, 403, { error: 'forbidden' });
      if (inv.status === 'active') return json(res, 200, { alreadyActive: true });
      const methods = { bankak: { name:'بنكك', account:cfg.sd.account }, fawry: { name:'فوري', account:cfg.sd.fawry }, ocash: { name:'أوكاش', account:cfg.sd.ocash } };
      const method = String(b.method || 'bankak');
      if (!methods[method] || !methods[method].account) return json(res, 400, { error: 'طريقة التحويل غير متاحة' });
      const txn = String(b.txn || '').trim().slice(0, 60);
      const sender = String(b.sender || '').trim().slice(0, 60);
      if (!txn || !sender) return json(res, 400, { error: 'رقم العملية واسم المحوِّل مطلوبان' });
      const transfer = await db.submitTransfer(inv.id,b.k,{txn,sender,method});
      if (!transfer) return json(res,403,{error:'forbidden'});
      if (transfer.alreadyActive) return json(res,200,{alreadyActive:true});
      const msg = `طلب تفعيل دعوة%0Aطريقة التحويل: ${encodeURIComponent(methods[method].name)}%0Aالاسم: ${encodeURIComponent(sender)}%0Aرقم العملية: ${encodeURIComponent(txn)}%0Aالرقم المرجعي: ${inv.referenceNumber}%0Aمعرّف الدعوة: ${inv.id}`;
      return json(res, 200, { ok: true, wa: `https://wa.me/${cfg.sd.whatsapp}?text=${msg}` });
    }

    /* ---------- ADMIN ---------- */
    if (p === '/api/admin') {
      if (!await requireAdmin(req, res, req.method !== 'GET')) return;
      if (req.method === 'GET') {
        const invites = await db.listInvites();
        const all = await Promise.all(invites.map(async i => ({
          id:i.id, referenceNumber:i.referenceNumber,status:i.status,template:i.template,email:i.email,
          groom:i.data.groom,bride:i.data.bride,date:i.data.date,createdAt:i.createdAt,paidAt:i.paidAt,
          bankTxn:i.bankTxn,bankSender:i.bankSender,bankMethod:i.bankMethod || 'bankak',
          rsvps:(await db.listRows('rsvp',i.id)).length,
        })));
        return json(res, 200, { invites: all, sold: await db.sold(), demoMode: cfg.demoMode });
      }
      if (req.method === 'POST') {
        const b = await readJson(req);
        const inv = await db.get(b.id);
        if (!inv) return json(res, 404, { error: 'not found' });
        let result = inv;
        if (b.action === 'activate') result=await db.activate(inv.id);
        else if (b.action === 'deactivate') result=await db.updateInvite(inv.id,current=>({...current,status:'draft'}));
        return json(res, 200, { ok: true, status: result.status });
      }
    }

    /* ---------- DEMO INVITE ---------- */
    if (p === '/i/demo' && req.method === 'GET') {
      const tpl = THEMES[u.searchParams.get('t')] ? u.searchParams.get('t') : 'garden';
      const demo = {
        id: 'demo', template: tpl, status: 'active',
        data: {
          groom: 'محمد', bride: 'سارة',
          date: '2026-12-18T19:30:00+03:00',
          venue: 'قاعة الأفراح الكبرى', address: 'الخرطوم — شارع الجامعة',
          mapQuery: 'Khartoum Sudan',
          rsvpBy: 'نرجو التأكيد قبل ١٥ ديسمبر',
          welcome: '',
          phone: '', music: '', photos: [],
          program: [
            { t: '١٩:٣٠', title: 'استقبال الضيوف', note: 'فتح الأبواب واستقبال المدعوّين' },
            { t: '٢٠:٣٠', title: 'دخول العروسين', note: 'الزفّة' },
            { t: '٢١:٣٠', title: 'العشاء', note: 'بوفيه عشاء ومشروبات' },
            { t: '٢٢:٣٠', title: 'الحفل والتهاني', note: 'صور تذكارية مع العروسين' },
          ],
        },
      };
      const html = renderInvite(demo);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(html);
    }

    /* ---------- RENDER INVITE ---------- */
    let mi = p.match(/^\/i\/([a-z0-9]+)$/);
    if (mi && req.method === 'GET') {
      const inv = await db.get(mi[1]);
      if (!inv) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<h1>الدعوة غير موجودة</h1>'); }
      if (inv.status !== 'active') { res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>الدعوة غير مفعّلة</title><main style="text-align:center;padding:4rem 1rem;font-family:sans-serif"><h1>الدعوة غير مفعّلة بعد</h1><p>ستكون متاحة بعد تأكيد التفعيل.</p></main></html>'); }
      const html = renderInvite(inv);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(html);
    }

    /* ---------- OG IMAGE (PNG أو SVG بديل) ---------- */
    let mo = p.match(/^\/og\/([a-z0-9]+)\.(png|svg)$/);
    if (mo && req.method === 'GET') {
      const inv = await db.get(mo[1]);
      if (!inv) { res.writeHead(404); return res.end(); }
      if (inv.status !== 'active') { res.writeHead(403, { 'cache-control': 'no-store' }); return res.end(); }
      const ext = mo[2];

      if (ext === 'png') {
        if (cloudFiles) {
          const bytes = await cloudFiles.get('og', inv.id);
          if (bytes) {
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length, 'cache-control': 'public, max-age=600', 'x-content-type-options': 'nosniff' });
            return res.end(bytes);
          }
        }
        const file = ogImagePath(inv);
        if (!cloudFiles && fs.existsSync(file)) {
          const st = fs.statSync(file);
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': st.size,
            'cache-control': 'public, max-age=600',
          });
          return fs.createReadStream(file).pipe(res);
        }
        // لا توجد صورة بعد → بديل SVG (المتصفحات وقارئات OG تقبله جزئيًا)
        const svg = ogSvg(inv);
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=60' });
        return res.end(svg);
      }

      const svg = ogSvg(inv);
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      return res.end(svg);
    }

    /* ---------- STATIC ---------- */
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);

    json(res, 404, { error: 'not found' });
  } catch (e) {
    const code = Number.isInteger(e.status) ? e.status : (Number.isInteger(e.code) ? e.code : 500);
    if (code >= 500) console.error('[err]', req.method, p, e.message);
    json(res, code, { error: e.code && e.code < 500 ? e.message : 'حدث خطأ في الخادم' });
  }
});

async function stripeGet(endpoint) {
  const res = await fetch('https://api.stripe.com/v1/' + endpoint, {
    headers: { authorization: 'Bearer ' + cfg.stripeKey },
  });
  return res.json().catch(() => ({}));
}

function verifyStripeSig(raw, header, secret) {
  try {
    const fields = header.split(',').map(x => x.trim().split('='));
    const timestamp = fields.find(([k]) => k === 't')?.[1];
    const signatures = fields.filter(([k]) => k === 'v1').map(([,v]) => v);
    if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000 - Number(timestamp)) > 300) return false;
    const expect = crypto.createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
    return signatures.some(sig => /^[a-f0-9]{64}$/i.test(sig || '') && crypto.timingSafeEqual(expect, Buffer.from(sig, 'hex')));
  } catch { return false; }
}

async function start() {
  // تُنشأ بيانات المدير مرة واحدة فقط، ولا يُستبدل حساب موجود أبدًا.
  const bootstrapUser = process.env.ADMIN_BOOTSTRAP_USERNAME || '';
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (!!bootstrapUser !== !!bootstrapPassword) throw new Error('إعداد مدير البداية غير مكتمل');
  if (bootstrapUser) await postgresAdmin.initialize(bootstrapUser,bootstrapPassword);
  if (!await postgresAdmin.read()) throw new Error('حساب الإدارة في قاعدة البيانات غير مهيأ');
  if (!cloudFiles) throw new Error('تخزين ملفات Supabase غير مهيأ');
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`\n  💍 زَفّة يعمل على المنفذ ${cfg.port}`);
    console.log(`     http://localhost:${cfg.port}`);
    console.log(`     الوضع: ${cfg.demoMode ? (cfg.allowDemoCheckout ? 'تجريبي (تفعيل مجاني للاختبار)' : 'تحويل محلي يدوي — البطاقة غير مفعّلة') : 'Stripe مُعدّ'}`);
    console.log('     التخزين: PostgreSQL وSupabase Storage (نسخة اختبارية)\n');
  });
}
start().catch(async e => {
  console.error('تعذّر تشغيل نسخة قاعدة البيانات:', e.message);
  await pool.end().catch(()=>{});
  process.exitCode=1;
});
