'use strict';
/* إدارة بيانات دخول المدير في PostgreSQL. لم تُربط بمسارات الموقع بعد. */
const crypto = require('crypto');
const { promisify } = require('util');
const pbkdf2 = promisify(crypto.pbkdf2);
const ITERATIONS = 310000;
function validUser(username) { return typeof username === 'string' && /^[A-Za-z0-9_.-]{3,40}$/.test(username); }
function validPassword(password) { return typeof password === 'string' && password.length >= 12 && password.length <= 200; }
function validRecord(a) {
  return a && validUser(a.username) && Number.isInteger(a.iterations) && a.iterations >= ITERATIONS && a.iterations <= 2000000 &&
    /^[a-f0-9]{32}$/.test(a.salt || '') && /^[a-f0-9]{64}$/.test(a.digest || '');
}
async function derive(password, salt, iterations) {
  return (await pbkdf2(password,Buffer.from(salt,'hex'),iterations,32,'sha256')).toString('hex');
}
async function makeRecord(username,password) {
  if (!validUser(username) || !validPassword(password)) throw new Error('اسم المستخدم أو كلمة المرور غير صالح');
  const salt=crypto.randomBytes(16).toString('hex');
  return {username,iterations:ITERATIONS,salt,digest:await derive(password,salt,ITERATIONS)};
}
async function matches(password, record) {
  if (!validRecord(record) || typeof password !== 'string' || password.length > 200) return false;
  const got=Buffer.from(await derive(password,record.salt,record.iterations),'hex');
  const expected=Buffer.from(record.digest,'hex');
  return crypto.timingSafeEqual(got,expected);
}
class PostgresAdmin {
  constructor(pool) { this.pool=pool; }
  async read() {
    const r=await this.pool.query("SELECT payload FROM zaffa_private.settings WHERE key='admin_auth'");
    const record=r.rows[0]?.payload;
    if (record && !validRecord(record)) throw new Error('بيانات حساب الإدارة غير صالحة');
    return record || null;
  }
  async initialize(username,password) {
    const record=await makeRecord(username,password);
    const r=await this.pool.query("INSERT INTO zaffa_private.settings(key,payload) VALUES ('admin_auth',$1::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key",[JSON.stringify(record)]);
    return r.rowCount === 1;
  }
  async verify(username,password) {
    const record=await this.read();
    if (!record) return null;
    const ok=await matches(password,record);
    return ok && username===record.username ? record : null;
  }
  async changePassword(currentPassword,newPassword) {
    if (!validPassword(newPassword)) throw new Error('كلمة المرور الجديدة يجب أن تكون من ١٢ إلى ٢٠٠ حرف');
    const record=await this.read();
    if (!record || !(await matches(currentPassword,record))) return false;
    const replacement=await makeRecord(record.username,newPassword);
    // مقارنة التجزئة السابقة تمنع سباق تغيير كلمة المرور بين جلستين.
    const result=await this.pool.query("UPDATE zaffa_private.settings SET payload=$1::jsonb WHERE key='admin_auth' AND payload->>'digest'=$2 RETURNING key",[JSON.stringify(replacement),record.digest]);
    return result.rowCount === 1;
  }
}
module.exports={PostgresAdmin};
