'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
const {PostgresAdmin}=require('../server/postgres-admin');
test('حساب الإدارة الجديد لا يستبدل الموجود وتغيير كلمة المرور يتطلب القديمة',async()=>{
 const db=new PGlite();
 try {
  await db.exec(fs.readFileSync(require('path').join(__dirname,'../supabase/schema.sql'),'utf8'));
  const auth=new PostgresAdmin(db);
  assert.equal(await auth.read(),null);
  await assert.rejects(auth.initialize('admin','short'));
  assert.equal(await auth.initialize('admin','Original-pass-123'),true);
  assert.equal(await auth.initialize('admin','Replacement-pass-123'),false);
  assert.equal(await auth.verify('admin','bad'),null);
  assert.equal(await auth.verify('wrong','Original-pass-123'),null);
  const stored=await auth.read();assert.notEqual(stored.digest,'Original-pass-123');
  assert.ok(await auth.verify('admin','Original-pass-123'));
  assert.equal(await auth.changePassword('wrong','Replacement-pass-123'),false);
  assert.equal(await auth.changePassword('Original-pass-123','Replacement-pass-123'),true);
  assert.equal(await auth.verify('admin','Original-pass-123'),null);
  assert.ok(await auth.verify('admin','Replacement-pass-123'));
  const races=await Promise.all([auth.changePassword('Replacement-pass-123','New-first-pass-123'),auth.changePassword('Replacement-pass-123','New-second-pass-123')]);
  assert.equal(races.filter(Boolean).length,1);
  const success=await Promise.all([auth.verify('admin','New-first-pass-123'),auth.verify('admin','New-second-pass-123')]);
  assert.equal(success.filter(Boolean).length,1);
 } finally { await db.close(); }
});
