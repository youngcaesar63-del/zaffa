'use strict';
// شغّله من طرفية موثوقة: node scripts/set-admin.js [اسم-المستخدم] [مسار-الملف]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync } = require('child_process');
const user = process.argv[2] || 'admin';
const file = path.resolve(process.argv[3] || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'admin-auth.json'));
if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('استخدم طرفية تفاعلية آمنة لتجنب كشف كلمة المرور.'); process.exit(1); }
if (!/^[A-Za-z0-9_.-]{3,40}$/.test(user)) { console.error('اسم المستخدم يجب أن يتكون من ٣ إلى ٤٠ حرفًا أو رقمًا لاتينيًا.'); process.exit(1); }
const rl = readline.createInterface({input:process.stdin, output:process.stdout});
function ask(q) { return new Promise(resolve => rl.question(q, resolve)); }
(async () => {
  let a, b;
  try {
    execFileSync('stty', ['-echo'], {stdio:'inherit'});
    a = await ask('كلمة المرور الجديدة (١٢ حرفًا على الأقل): '); console.log();
    b = await ask('أعد كلمة المرور: '); console.log();
  } finally { execFileSync('stty', ['echo'], {stdio:'inherit'}); rl.close(); }
  if (a.length < 12 || a.length > 200 || a !== b) throw new Error('كلمة المرور قصيرة أو غير متطابقة.');
  const salt = crypto.randomBytes(16).toString('hex'), iterations = 310000;
  const digest = crypto.pbkdf2Sync(a, Buffer.from(salt,'hex'), iterations, 32, 'sha256').toString('hex');
  fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify({username:user,iterations,salt,digest}), {mode:0o600}); fs.renameSync(tmp,file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
  console.log('تم تحديث حساب الإدارة. أعد تسجيل الدخول؛ احتفظ بالملف خارج جذر الموقع.');
})().catch(e => { console.error(e.message); process.exitCode=1; });
