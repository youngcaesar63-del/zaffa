/* ==========================================================
   زَفّة — مولّد كرت الدعوة (Canvas → PNG)
   يولّد صورة دعوة أنيقة جاهزة للمشاركة على واتساب/ستوري.
   ========================================================== */
'use strict';

window.InviteCard = (function () {

  const W = 1080, H = 1620;

  const PALETTES = {
    garden:  { bg1:'#fffdfc', bg2:'#fbeef2', bg3:'#f5dde4', ink:'#5c2438', soft:'#8a5468', gold:['#e8c9a0','#c99a6e','#a67c52'], accent:'#c9798c' },
    saudi:   { bg1:'#fffdf7', bg2:'#fbf3e2', bg3:'#f1e3c3', ink:'#43341a', soft:'#7a6742', gold:['#e8ce8c','#c0a050','#8f7328'], accent:'#b8912f' },
    crystal: { bg1:'#fdfeff', bg2:'#f2f6fa', bg3:'#e2eaf2', ink:'#283039', soft:'#5d6a76', gold:['#d6dee6','#a8b4c0','#78848f'], accent:'#7c8794' },
    'henna-groom': { bg1:'#45101d', bg2:'#570f20', bg3:'#2f0a13', ink:'#fff5e4', soft:'#ead2a5', gold:['#f1dbab','#c69d61','#8b6a34'], accent:'#c69d61' },
    jirtig:  { bg1:'#fffdf8', bg2:'#fff5e7', bg3:'#f1dec7', ink:'#591c22', soft:'#8e292d', gold:['#e2c27f','#aa3033','#7a2526'], accent:'#a92c2e' },
    sudan:   { bg1:'#fffdf9', bg2:'#fdf2e8', bg3:'#f4dfc6', ink:'#52260f', soft:'#8a4c2a', gold:['#e8b878','#c08640','#8f5c22'], accent:'#b5642e' },
    levant:  { bg1:'#fdfffe', bg2:'#eef7f3', bg3:'#dcefe8', ink:'#1e4438', soft:'#557a6d', gold:['#d3e8d8','#a8cfbe','#3f7d6e'], accent:'#3f7d6e' },
    // 🤵 حفل الرجال — عنّابي داكن ونحاسي (بطاقة داكنة)
    men:     { bg1:'#2e1419', bg2:'#241016', bg3:'#160a0e', ink:'#f7edd6', soft:'#d9b878', gold:['#e2c48c','#c89650','#8a6330'], accent:'#c89650' },
    // 👰 حفل النساء — وردي لؤلؤي
    women:   { bg1:'#fffdfe', bg2:'#fdeef4', bg3:'#f8d9e6', ink:'#7d2f47', soft:'#a8607f', gold:['#f0cdd9','#dba2b8','#b06a86'], accent:'#d68caa' },
    // العاج الملكي — عاجي وتذهيب كلاسيكي
    ivory:   { bg1:'#fffdf8', bg2:'#faf2e2', bg3:'#f1e4ca', ink:'#3d3018', soft:'#8a6a22', gold:['#e6cd93','#a8802f','#6f4f14'], accent:'#a8802f' },
    // المخمل العنّابي — داكن درامي
    velvet:  { bg1:'#4a0d18', bg2:'#38080f', bg3:'#22050a', ink:'#fbeee6', soft:'#d9a4a4', gold:['#e8b9b9','#a8324a','#6d1424'], accent:'#d0566e' },
    // الذهب والليل — أسود وذهب
    thuluth: { bg1:'#1f1a0d', bg2:'#171208', bg3:'#0d0a04', ink:'#f3ecd8', soft:'#c9a227', gold:['#f0d888','#c9a227','#7d6110'], accent:'#c9a227' },
    // غروب المدينة — وردي وبنفسجي
    sunset:  { bg1:'#fde8f0', bg2:'#f7b8ce', bg3:'#c2547e', ink:'#3d1f45', soft:'#8a3358', gold:['#f6b6cd','#c2547e','#8a3358'], accent:'#c2547e' },
    // زهر الياسمين — أزرق فاتح
    blossom: { bg1:'#ffffff', bg2:'#eef5fa', bg3:'#dbe8f2', ink:'#2b4157', soft:'#6b8fb5', gold:['#bcd3e5','#6b8fb5','#456b8f'], accent:'#6b8fb5' },
    // رخام وذهب — أبيض وذهبي ديكو
    marble:  { bg1:'#ffffff', bg2:'#f7f5f0', bg3:'#eae5d9', ink:'#332c1e', soft:'#7a6535', gold:['#e4d5ae','#9a8149','#5f4f26'], accent:'#9a8149' },
    // الزمرد الملكي — أخضر داكن
    emerald: { bg1:'#eef7f3', bg2:'#d9ece4', bg3:'#b9dbcd', ink:'#0d3327', soft:'#1f6b52', gold:['#e2d79a','#c9b872','#8a7a3a'], accent:'#1f6b52' },
    // الطين والسنبلة — تراكوتا
    terracotta: { bg1:'#fffaf4', bg2:'#f8ebde', bg3:'#ecd6bd', ink:'#4a2412', soft:'#8a4520', gold:['#e0a878','#b26237','#7a3d1c'], accent:'#b26237' },
    // الكتّان الهادئ — بيج
    linen:   { bg1:'#fffefb', bg2:'#f6f2ea', bg3:'#e8e1d5', ink:'#3d362b', soft:'#8a7a63', gold:['#d8cdba','#a89a83','#6b5f4d'], accent:'#8a7a63' },
    // فانوس الليل — كحلي وذهبي
    lantern: { bg1:'#16253d', bg2:'#101d33', bg3:'#08111f', ink:'#f6f1e4', soft:'#e6c583', gold:['#f0dca8','#c99a3f','#7d5c18'], accent:'#c99a3f' },
  };
  // سعودي الرجال/النساء يستخدم لوحته الخاصة لا لوحة saudi
  const CARD_KEY = { 'saudi-m':'men', 'saudi-w':'women' };

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const DAYS = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

  let fontsPromise = null;
  function loadFonts(){
    if (fontsPromise) return fontsPromise;
    if (!document.querySelector('link[data-zaffa-fonts]')){
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.dataset.zaffaFonts = '1';
      l.href = '/assets/fonts/fonts.css';
      document.head.appendChild(l);
    }
    const loads = [
      document.fonts.load('700 80px "Amiri"', 'محمد'),
      document.fonts.load('400 40px "Amiri"', 'بسم'),
      document.fonts.load('700 40px "Tajawal"', 'حفل'),
      document.fonts.load('800 40px "Tajawal"', 'حفل'),
      document.fonts.load('400 40px "Tajawal"', 'حفل'),
    ];
    fontsPromise = Promise.all(loads).catch(() => {}).then(() => document.fonts.ready);
    return fontsPromise;
  }

  const toAr = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

  function parse(s){
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return { y:2026, mo:12, d:18, h:19, mi:30 };
    return { y:+m[1], mo:+m[2], d:+m[3], h:m[4]!=null?+m[4]:19, mi:m[5]!=null?+m[5]:30 };
  }

  function rr(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  /* ملاءمة النص داخل عرض محدد */
  function fitText(ctx, text, family, weight, size, maxW, minSize){
    let s = size;
    do {
      ctx.font = `${weight} ${s}px ${family}`;
      if (ctx.measureText(text).width <= maxW || s <= minSize) break;
      s -= 2;
    } while (s > minSize);
    return s;
  }

  /* رسم وردة مزخرفة ببتلات متراكبة */
  function rose(ctx, cx, cy, r, accent, ink, light){
    // أوراق
    ctx.save();
    ctx.translate(cx, cy);
    [[-1, -.5], [1, .5]].forEach(([dir, ang]) => {
      ctx.save(); ctx.rotate(ang * dir);
      const lg = ctx.createLinearGradient(0, 0, dir * r * 1.7, 0);
      lg.addColorStop(0, '#7fae8c'); lg.addColorStop(1, '#4e7f5d');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(dir * r * 1.05, r * .5, r * .68, r * .27, dir * .45, 0, Math.PI * 2);
      ctx.fill();
      // عرق الورقة
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, r * .035);
      ctx.beginPath();
      ctx.moveTo(dir * r * .45, r * .5); ctx.lineTo(dir * r * 1.6, r * .5);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();

    // بتلات خارجية
    for (let layer = 0; layer < 3; layer++){
      const lr = r * (1 - layer * .22);
      const petals = 5 - layer;
      for (let i = 0; i < petals; i++){
        const a = (i / petals) * Math.PI * 2 + layer * .55;
        const px = cx + Math.cos(a) * lr * .34;
        const py = cy + Math.sin(a) * lr * .34;
        const g = ctx.createRadialGradient(px - r*.15, py - r*.15, r*.05, px, py, lr * .78);
        g.addColorStop(0, light);
        g.addColorStop(.55, accent);
        g.addColorStop(1, ink);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, lr * .62, lr * .48, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // قلب الوردة
    const core = ctx.createRadialGradient(cx - r*.12, cy - r*.14, r*.04, cx, cy, r*.42);
    core.addColorStop(0, light);
    core.addColorStop(.7, accent);
    core.addColorStop(1, ink);
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r * .34, 0, Math.PI * 2); ctx.fill();

    // لفائف القلب
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.lineWidth = Math.max(1.2, r * .045);
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++){
      ctx.beginPath();
      ctx.arc(cx, cy, r * (.24 - i*.1), -1.1 + i*.7, 2.0 + i*.7);
      ctx.stroke();
    }
    // لمعة
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.beginPath();
    ctx.ellipse(cx - r*.3, cy - r*.38, r*.2, r*.09, -.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function ornament(ctx, cx, y, w, color){
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - w/2, y); ctx.lineTo(cx - 26, y);
    ctx.moveTo(cx + 26, y); ctx.lineTo(cx + w/2, y);
    ctx.stroke();
    // قلب صغير
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, y + 9);
    ctx.bezierCurveTo(cx - 17, y - 3, cx - 9, y - 16, cx, y - 5);
    ctx.bezierCurveTo(cx + 9, y - 16, cx + 17, y - 3, cx, y + 9);
    ctx.fill();
  }

  /* ============ الرسم الرئيسي ============ */
  async function draw(data, template, opts = {}){
    await loadFonts();
    const key = CARD_KEY[template] || template;
    const p = PALETTES[key] || PALETTES.garden;
    const dark = (key === 'henna-groom' || key === 'men' || key === 'velvet' || key === 'thuluth' || key === 'lantern');
    const D = parse(data.date);
    const side = (data.theme && data.theme.side) || ({'saudi-m':'m','saudi-w':'w','henna-groom':'m'}[template] || '');

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.direction = 'rtl';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';

    /* الخلفية */
    const bg = x.createLinearGradient(0, 0, W*.4, H);
    bg.addColorStop(0, p.bg1);
    bg.addColorStop(.55, p.bg2);
    bg.addColorStop(1, p.bg3);
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

    /* هالة ضوء */
    const halo = x.createRadialGradient(W/2, H*.12, 40, W/2, H*.12, W*.9);
    halo.addColorStop(0, dark ? 'rgba(200,150,80,.20)' : 'rgba(255,255,255,.9)');
    halo.addColorStop(1, dark ? 'rgba(200,150,80,0)' : 'rgba(255,255,255,0)');
    x.fillStyle = halo;
    x.fillRect(0, 0, W, H);

    /* إطار مزدوج */
    const m1 = 46, m2 = 62;
    x.strokeStyle = p.gold[1]; x.lineWidth = 2.5;
    rr(x, m1, m1, W - m1*2, H - m1*2, 26); x.stroke();
    x.strokeStyle = p.gold[0]; x.lineWidth = 1.2;
    rr(x, m2, m2, W - m2*2, H - m2*2, 20); x.stroke();

    /* زوايا مزخرفة */
    const corner = (cx, cy, sx, sy) => {
      x.save(); x.translate(cx, cy); x.scale(sx, sy);
      x.strokeStyle = p.gold[1]; x.lineWidth = 2.4; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(0, 54); x.quadraticCurveTo(0, 0, 54, 0);
      x.stroke();
      x.beginPath(); x.arc(20, 20, 5, 0, Math.PI*2);
      x.fillStyle = p.gold[1]; x.fill();
      x.restore();
    };
    corner(m2 + 30, m2 + 30, 1, 1);
    corner(W - m2 - 30, m2 + 30, -1, 1);
    corner(m2 + 30, H - m2 - 30, 1, -1);
    corner(W - m2 - 30, H - m2 - 30, -1, -1);

    /* ورد
       */
    rose(x, 152, 218, 40, p.accent, p.ink, '#ffffff');
    rose(x, W - 152, 218, 40, p.accent, p.ink, '#ffffff');

    let y = 318;

    /* البسملة */
    x.fillStyle = p.soft;
    x.font = '700 36px Amiri, serif';
    x.fillText('بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ', W/2, y);

    y += 58;
    ornament(x, W/2, y, 300, p.gold[1]);

    y += 82;
    /* الآية */
    x.fillStyle = p.soft;
    x.font = '400 29px Amiri, serif';
    x.fillText('وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا', W/2, y);
    x.fillText('لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً', W/2, y + 42);

    y += 96;
    ornament(x, W/2, y, 200, p.gold[0]);

    /* العبارة */
    y += 72;
    const phrase = (data.theme && data.theme.phrase)
      || (typeof PHRASES !== 'undefined' && PHRASES[template]?.line)
      || (template === 'henna-groom' ? 'بكل فرح ندعوكم لمشاركتنا ليلة حنة العريس' : side === 'm' ? 'بكل فخر وسرور ندعوكم لحضور حفل زواج'
        : side === 'w' ? 'بكل حب وسعادة ندعوكنّ لحضور حفل زفاف'
        : 'ندعوكم لحضور حفل زفاف');
    const phSize = fitText(x, phrase, 'Tajawal, sans-serif', '500', 31, W - 340, 20);
    x.fillStyle = p.accent;
    x.font = `500 ${phSize}px Tajawal, sans-serif`;
    x.fillText(phrase, W/2, y);

    /* ================= الأسماء ================= */
    const names = side === 'm' ? [data.groom]
      : side === 'w' ? [data.bride]
      : [data.groom, data.bride];

    // خط Amiri يحتاج مساحة رأسية كبيرة (صواعد وذوائل) — نستخدم تباعدًا ثابتًا سخيًّا
    const GAP = 152;              // المسافة بين منتصف كل سطر
    let ny = y + 118;
    x.textBaseline = 'middle';

    if (names.length === 1){
      const nm = String(names[0] || 'العريس');
      const s1 = fitText(x, nm, 'Amiri, serif', '700', 118, W - 380, 48);
      x.font = `700 ${s1}px Amiri, serif`;
      x.fillStyle = p.ink;
      x.fillText(nm, W/2, ny);
      ny += GAP;
    } else {
      const gN = String(names[0] || 'العريس');
      const bN = String(names[1] || 'العروس');

      // الاسم الأول
      const s1 = fitText(x, gN, 'Amiri, serif', '700', 92, W - 320, 38);
      x.font = `700 ${s1}px Amiri, serif`;
      x.fillStyle = p.ink;
      x.fillText(gN, W/2, ny);

      // "و" في المنتصف
      ny += GAP;
      x.fillStyle = p.gold[1];
      x.font = '700 44px Amiri, serif';
      x.fillText('و', W/2, ny);
      x.strokeStyle = p.gold[0]; x.lineWidth = 1.3;
      x.beginPath();
      x.moveTo(W/2 - 158, ny); x.lineTo(W/2 - 48, ny);
      x.moveTo(W/2 + 48, ny);  x.lineTo(W/2 + 158, ny);
      x.stroke();

      // الاسم الثاني
      ny += GAP;
      const s2 = fitText(x, bN, 'Amiri, serif', '700', 92, W - 320, 38);
      x.font = `700 ${s2}px Amiri, serif`;
      x.fillStyle = p.ink;
      x.fillText(bN, W/2, ny);
      ny += GAP * .42;
    }
    x.textBaseline = 'alphabetic';

    /* ================= التاريخ والمكان ================= */
    y = ny + 38;
    ornament(x, W/2, y, 340, p.gold[1]);

    y += 64;
    const wd = DAYS[new Date(Date.UTC(D.y, D.mo-1, D.d)).getUTCDay()];
    const dateTxt = `${wd} — ${toAr(D.d)} ${MONTHS[D.mo-1]} ${toAr(D.y)}`;
    x.fillStyle = p.accent;
    x.font = '700 42px Tajawal, sans-serif';
    x.fillText(dateTxt, W/2, y);

    y += 52;
    const h12 = ((D.h + 11) % 12) + 1;
    const timeTxt = `${toAr(h12)}:${toAr(String(D.mi).padStart(2,'0'))} ${D.h < 12 ? 'صباحاً' : 'مساءً'}`;
    x.fillStyle = p.soft;
    x.font = '500 33px Tajawal, sans-serif';
    x.fillText(timeTxt, W/2, y);

    /* القاعة */
    y += 68;
    if (data.venue){
      const vs = fitText(x, data.venue, 'Tajawal, sans-serif', '800', 38, W - 320, 22);
      x.fillStyle = p.ink;
      x.font = `800 ${vs}px Tajawal, sans-serif`;
      x.fillText(data.venue, W/2, y);
      y += 42;
    }
    if (data.address){
      const as = fitText(x, data.address, 'Tajawal, sans-serif', '400', 27, W - 340, 18);
      x.fillStyle = p.soft;
      x.font = `400 ${as}px Tajawal, sans-serif`;
      x.fillText(data.address, W/2, y);
    }

    /* التذييل */
    x.fillStyle = p.gold[1];
    x.font = '400 25px Amiri, serif';
    x.fillText('بارك الله لكما وبارك عليكما وجمع بينكما في خير', W/2, H - 118);

    x.fillStyle = p.soft;
    x.font = '700 21px Tajawal, sans-serif';
    x.fillText('زَفّة · دعوات إلكترونية', W/2, H - 66);

    /* صورة الشخص اختياريًا */


    return cv;
  }

  async function toBlob(data, template, opts){
    const cv = await draw(data, template, opts);
    return new Promise(res => cv.toBlob(res, 'image/png', 0.95));
  }

  async function download(data, template, filename){
    const blob = await toBlob(data, template);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'invitation.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { draw, toBlob, download };
})();
