'use strict';
/* عميل خادمي لملفات الدعوات. لا يُستخدم بعد في مسارات الموقع الحالية.
   يجب استخدام حاوية خاصة، ولا يُرسل مفتاح الخادم إلى المتصفح. */

const MAX_BYTES = { music: 8 * 1024 * 1024, og: 4_000_000 };
const TYPES = { music: { extension: 'mp3', mime: 'audio/mpeg' }, og: { extension: 'png', mime: 'image/png' } };

class StorageError extends Error {
  constructor(message, status) { super(message); this.name = 'StorageError'; this.status = status; }
}

class SupabaseStorage {
  constructor({ url, secretKey, bucket = 'zaffa-private', fetchImpl = globalThis.fetch }) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('عنوان Supabase غير صالح'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
      throw new Error('يجب أن يكون عنوان Supabase عنوان HTTPS أساسيًا');
    if (typeof secretKey !== 'string' || !secretKey.trim()) throw new Error('مفتاح Supabase الخادمي مطلوب');
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket)) throw new Error('اسم حاوية التخزين غير صالح');
    if (typeof fetchImpl !== 'function') throw new Error('fetch غير متاح');
    this.origin = parsed.origin;
    this.key = secretKey;
    this.bucket = bucket;
    this.fetch = fetchImpl;
  }

  objectUrl(kind, inviteId) {
    if (!TYPES[kind] || typeof inviteId !== 'string' || !/^[a-z0-9]{1,40}$/.test(inviteId))
      throw new Error('نوع الملف أو معرّف الدعوة غير صالح');
    return `${this.origin}/storage/v1/object/${encodeURIComponent(this.bucket)}/${kind}/${inviteId}.${TYPES[kind].extension}`;
  }

  headers() { return { apikey: this.key, authorization: `Bearer ${this.key}` }; }

  async put(kind, inviteId, bytes) {
    const url = this.objectUrl(kind, inviteId);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES[kind])
      throw new Error('حجم الملف غير صالح');
    let response;
    try {
      response = await this.fetch(url, { method: 'POST', headers: { ...this.headers(), 'content-type': TYPES[kind].mime, 'x-upsert': 'true' }, body: bytes, signal: AbortSignal.timeout(30000) });
    } catch { throw new StorageError('تعذّر الاتصال بتخزين Supabase', 503); }
    if (!response.ok) throw new StorageError('تعذّر حفظ الملف في Supabase', 503);
  }

  async get(kind, inviteId) {
    const url = this.objectUrl(kind, inviteId);
    let response;
    try { response = await this.fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(30000) }); }
    catch { throw new StorageError('تعذّر الاتصال بتخزين Supabase', 503); }
    if (response.status === 404) return null;
    if (!response.ok) throw new StorageError('تعذّر قراءة الملف من Supabase', 503);
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > MAX_BYTES[kind]) throw new StorageError('حجم الملف المخزن غير صالح', 503);
    // قراءة بحد أقصى حتى لو لم يرسل الخادم Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new StorageError('تعذّر قراءة الملف من Supabase', 503);
    let size = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES[kind]) { await reader.cancel(); throw new StorageError('حجم الملف المخزن غير صالح', 503); }
        chunks.push(Buffer.from(value));
      }
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError('تعذّر قراءة الملف من Supabase', 503);
    }
    return Buffer.concat(chunks, size);
  }
}
module.exports = { SupabaseStorage, StorageError };
