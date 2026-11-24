'use strict';
/* تخزين JSON ذرّي — بلا أي حزم خارجية.
   - يُحمّل الملف كاملًا في الذاكرة عند الإقلاع
   - كل تعديل يكتب إلى ملف مؤقت ثم يُستبدل ذرّيًا (rename)
   - كتابة مؤجّلة (debounce) لتجميع التعديلات السريعة */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = { invites: {}, rsvps: [], wishes: [], meta: { sold: 0 } };

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.tmp = this.file + '.tmp';
    this.data = EMPTY;
    this._timer = null;
    this._dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
    this.ensureReferences();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || Array.isArray(d) || !d.invites || typeof d.invites !== 'object' || Array.isArray(d.invites) || !Array.isArray(d.rsvps) || !Array.isArray(d.wishes)) throw new Error('بنية قاعدة البيانات غير صالحة');
      this.data = Object.assign({}, EMPTY, d);
      if (!this.data.meta) this.data.meta = { sold: 0 };
    } catch (e) {
      // لا تستبدل قاعدة موجودة عند تلفها أو تعذر قراءتها؛ توقّف لحماية البيانات.
      if (e.code !== 'ENOENT') throw new Error('تعذّر قراءة قاعدة البيانات؛ لم تُستبدل: ' + e.message);
      this.data = JSON.parse(JSON.stringify(EMPTY));
      if (!this.flush()) throw new Error('تعذّر إنشاء قاعدة البيانات');
    }
  }

  flush() {
    this._dirty = false;
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.writeFileSync(this.tmp, JSON.stringify(this.data, null, 0), {encoding:'utf8',mode:0o600});
      fs.chmodSync(this.tmp, 0o600);
      fs.renameSync(this.tmp, this.file);
      return true;
    } catch (e) {
      console.error('[db] write failed:', e.message);
      return false;
    }
  }

  touch() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { if (this._dirty) this.flush(); }, 120);
  }

  // تخصيص أرقام ثابتة للدعوات القديمة مرة واحدة عند الترقية.
  ensureReferences() {
    const invites = Object.values(this.data.invites);
    const used = new Set();
    let max = 1000, changed = false;
    for (const inv of invites) {
      if (Number.isSafeInteger(inv.referenceNumber) && inv.referenceNumber >= 1001) {
        if (used.has(inv.referenceNumber)) throw new Error('Duplicate invite reference number');
        used.add(inv.referenceNumber); max = Math.max(max, inv.referenceNumber);
      }
    }
    max = Math.max(max, Number.isSafeInteger(this.data.meta.lastReferenceNumber) ? this.data.meta.lastReferenceNumber : 1000);
    for (const inv of invites.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
      if (!Number.isSafeInteger(inv.referenceNumber) || inv.referenceNumber < 1001) {
        inv.referenceNumber = ++max; changed = true;
      }
    }
    if (this.data.meta.lastReferenceNumber !== max) { this.data.meta.lastReferenceNumber = max; changed = true; }
    if (changed && !this.flush()) throw new Error('Failed to persist invite reference migration');
  }

  /* ---------- helpers ---------- */
  static id(len = 8) {
    const A = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    const b = crypto.randomBytes(len);
    for (let i = 0; i < len; i++) s += A[b[i] % A.length];
    return s;
  }
  static key() {
    return crypto.randomBytes(16).toString('hex');
  }

  sold() { return this.data.meta.sold || 0; }

  createInvite({ data, email, template }) {
    let id; do { id = Store.id(8); } while (this.data.invites[id]);
    const key = Store.key();
    const referenceNumber = this.data.meta.lastReferenceNumber + 1;
    if (!Number.isSafeInteger(referenceNumber)) throw new Error('Reference number limit reached');
    const inv = {
      id, key, referenceNumber,
      status: 'draft',
      template: template || 'garden',
      data: data || {},
      email: email || '',
      addon: false,
      createdAt: new Date().toISOString(),
      paidAt: null,
      stripeSessionId: null,
      bankTxn: null,
      bankSender: null,
    };
    this.data.invites[id] = inv;
    this.data.meta.lastReferenceNumber = referenceNumber;
    // يحفظ الرقم والدعوة قبل إرجاعهما، حتى لا يُعاد استخدام الرقم بعد إعادة التشغيل.
    if (!this.flush()) { delete this.data.invites[id]; this.data.meta.lastReferenceNumber = referenceNumber - 1; throw new Error('تعذّر حفظ الدعوة'); }
    return inv;
  }

  get(id) { return this.data.invites[id] || null; }

  activate(inv) {
    if (inv.status !== 'active') {
      inv.status = 'active';
      inv.paidAt = new Date().toISOString();
      this.data.meta.sold = (this.data.meta.sold || 0) + 1;
    } else if (inv.paidAt) {
      inv.paidAt = new Date().toISOString();
    }
    this.touch();
  }

  addRsvp(r) {
    const row = Object.assign({ id: Store.id(10), createdAt: new Date().toISOString() }, r);
    this.data.rsvps.push(row);
    this.touch();
    return row;
  }

  addWish(w) {
    const row = Object.assign({ id: Store.id(10), hidden: false, createdAt: new Date().toISOString() }, w);
    this.data.wishes.push(row);
    this.touch();
    return row;
  }

  rsvpsFor(id) { return this.data.rsvps.filter(r => r.inviteId === id); }
  wishesFor(id, includeHidden = false) {
    return this.data.wishes.filter(w => w.inviteId === id && (includeHidden || !w.hidden));
  }

}

module.exports = { Store };
