'use strict';
/* طبقة PostgreSQL أولية غير موصولة بعد بمسارات التطبيق.
   لا تُستخدم إلا من الخادم. لا توجد هنا مفاتيح أو بيانات دخول افتراضية. */
const crypto = require('crypto');
const { Pool } = require('pg');

function createPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL مطلوب');
  let parsed;
  try { parsed = new URL(connectionString); } catch { throw new Error('DATABASE_URL غير صالح'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('DATABASE_URL غير صالح');
  // لا نسمح بإضعاف التحقق من شهادة TLS من خلال عنوان الاتصال.
  if (parsed.searchParams.has('sslmode') || parsed.searchParams.has('sslcert') || parsed.searchParams.has('sslkey') || parsed.searchParams.has('sslrootcert'))
    throw new Error('احذف إعدادات SSL من DATABASE_URL؛ يتولى الخادم ضبط TLS');
  return new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 10000 });
}
function id(len=8) {
  const alphabet='abcdefghijkmnpqrstuvwxyz23456789';
  const bytes=crypto.randomBytes(len); let s='';
  for (const b of bytes) s+=alphabet[b % alphabet.length];
  return s;
}
function inviteFromRow(row) {
  if (!row) return null;
  const referenceNumber = Number(row.reference_number);
  if (!Number.isSafeInteger(referenceNumber)) throw new Error('رقم مرجعي خارج المجال المسموح');
  return {...row.payload, id:row.id, referenceNumber};
}
class PostgresStore {
  constructor(pool) { this.pool=pool; }
  async transaction(fn) {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result; }
    catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; }
    finally { client.release(); }
  }
  async createInvite({data,email,template}) {
    const invite={id:id(),key:crypto.randomBytes(16).toString('hex'),status:'draft',template:template||'garden',data:data||{},email:email||'',addon:false,createdAt:new Date().toISOString(),paidAt:null,stripeSessionId:null,bankTxn:null,bankSender:null};
    const result=await this.pool.query('INSERT INTO zaffa_private.invites (id,payload) VALUES ($1,$2::jsonb) RETURNING id,reference_number,payload',[invite.id,JSON.stringify(invite)]);
    return inviteFromRow(result.rows[0]);
  }
  async get(id) {
    const result=await this.pool.query('SELECT id,reference_number,payload FROM zaffa_private.invites WHERE id=$1',[id]);
    return inviteFromRow(result.rows[0]);
  }
  // تحديثات الدعوة تُنفّذ تحت قفل للصف لتجنّب الكتابة المتزامنة فوق بعضها.
  async updateInvite(inviteId, change) {
    return this.transaction(async client=>{
      const found=await client.query('SELECT id,reference_number,payload FROM zaffa_private.invites WHERE id=$1 FOR UPDATE',[inviteId]);
      const original=inviteFromRow(found.rows[0]);
      if (!original) return null;
      const changed=await change({...original});
      if (!changed || changed.id!==original.id || changed.referenceNumber!==original.referenceNumber) throw new Error('تحديث الدعوة غير صالح');
      const {referenceNumber,...payload}=changed;
      await client.query('UPDATE zaffa_private.invites SET payload=$2::jsonb WHERE id=$1',[inviteId,JSON.stringify(payload)]);
      return changed;
    });
  }
  // عمليات الدفع والتفعيل تحافظ على أي تغييرات متزامنة عبر قفل الصف.
  async activate(id, { addon = false } = {}) {
    return this.updateInvite(id, inv => {
      if (addon) inv.addon = true;
      if (inv.status !== 'active') { inv.status = 'active'; inv.paidAt = new Date().toISOString(); }
      return inv;
    });
  }
  async submitTransfer(id, editKey, {txn, sender, method}) {
    if (!['bankak','fawry','ocash'].includes(method) || !txn || !sender) throw new Error('بيانات التحويل غير صالحة');
    return this.transaction(async client => {
      const found = await client.query('SELECT id,reference_number,payload FROM zaffa_private.invites WHERE id=$1 FOR UPDATE',[id]);
      const inv = inviteFromRow(found.rows[0]);
      if (!inv || inv.key !== editKey) return null;
      if (inv.status === 'active') return {alreadyActive:true, invite:inv};
      inv.bankTxn=String(txn).trim().slice(0,60); inv.bankSender=String(sender).trim().slice(0,60); inv.bankMethod=method;
      if (!inv.bankTxn || !inv.bankSender) throw new Error('بيانات التحويل غير صالحة');
      inv.status='pending';
      const {referenceNumber,...payload}=inv;
      await client.query('UPDATE zaffa_private.invites SET payload=$2::jsonb WHERE id=$1',[id,JSON.stringify(payload)]);
      return {alreadyActive:false, invite:inv};
    });
  }
  async sold() {
    const result = await this.pool.query("SELECT count(*)::bigint AS n FROM zaffa_private.invites WHERE payload->>'paidAt' IS NOT NULL");
    return Number(result.rows[0].n);
  }
  async listInvites() {
    const result=await this.pool.query('SELECT id,reference_number,payload FROM zaffa_private.invites ORDER BY created_at DESC');
    return result.rows.map(inviteFromRow);
  }
  async listRows(kind, inviteId) {
    const table=kind === 'rsvp' ? 'rsvps' : kind === 'wish' ? 'wishes' : null;
    if (!table) throw new Error('نوع السجل غير صالح');
    const result=await this.pool.query(`SELECT payload FROM zaffa_private.${table} WHERE invite_id=$1 ORDER BY created_at`,[inviteId]);
    return result.rows.map(r=>r.payload);
  }
  // يمنع الإضافة للدعوات غير المفعّلة، مع قفل صف الدعوة خلال العملية.
  async addGuestRow(kind, inviteId, fields) {
    const table=kind === 'rsvp' ? 'rsvps' : kind === 'wish' ? 'wishes' : null;
    if (!table) throw new Error('نوع السجل غير صالح');
    return this.transaction(async client=>{
      const found=await client.query('SELECT payload FROM zaffa_private.invites WHERE id=$1 FOR UPDATE',[inviteId]);
      if (!found.rows[0] || found.rows[0].payload.status !== 'active') return null;
      const row={...fields,id:id(10),inviteId,createdAt:new Date().toISOString()};
      if (kind === 'wish') row.hidden=false;
      await client.query(`INSERT INTO zaffa_private.${table} (id,invite_id,payload) VALUES ($1,$2,$3::jsonb)`,[row.id,inviteId,JSON.stringify(row)]);
      return row;
    });
  }
  async updateGuestRow(kind, inviteId, rowId, change, requireActive=false) {
    const table=kind === 'rsvp' ? 'rsvps' : kind === 'wish' ? 'wishes' : null;
    if (!table) throw new Error('نوع السجل غير صالح');
    return this.transaction(async client=>{
      // ترتيب الأقفال ثابت: الدعوة أولًا ثم السجل.
      const inv=await client.query('SELECT payload FROM zaffa_private.invites WHERE id=$1 FOR UPDATE',[inviteId]);
      if (!inv.rows[0] || (requireActive && inv.rows[0].payload.status !== 'active')) return null;
      const found=await client.query(`SELECT payload FROM zaffa_private.${table} WHERE invite_id=$1 AND id=$2 FOR UPDATE`,[inviteId,rowId]);
      if (!found.rows[0]) return null;
      const original=found.rows[0].payload;
      const updated=await change({...original});
      if (!updated) return null;
      if (updated.id!==original.id || updated.inviteId!==original.inviteId || updated.createdAt!==original.createdAt) throw new Error('تحديث السجل غير صالح');
      await client.query(`UPDATE zaffa_private.${table} SET payload=$3::jsonb WHERE invite_id=$1 AND id=$2`,[inviteId,rowId,JSON.stringify(updated)]);
      return updated;
    });
  }
  async getSetting(key) {
    const result=await this.pool.query('SELECT payload FROM zaffa_private.settings WHERE key=$1',[key]);
    return result.rows[0]?.payload || null;
  }
  async setSetting(key, payload) {
    if (typeof key!=='string' || !/^[a-z][a-z0-9_]{0,39}$/.test(key) || !payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error('الإعداد غير صالح');
    await this.pool.query('INSERT INTO zaffa_private.settings(key,payload) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload',[key,JSON.stringify(payload)]);
  }
  async close() { await this.pool.end(); }
}
module.exports={PostgresStore,createPool};
