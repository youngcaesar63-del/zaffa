'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PostgresStore,createPool}=require('../server/postgres-store');

test('يتحقق من إعداد الاتصال ولا يسمح بتعطيل التحقق من TLS',()=>{
  assert.throws(()=>createPool(''));
  assert.throws(()=>createPool('https://example.com/db'));
  assert.throws(()=>createPool('postgresql://u:p@example.com/db?sslmode=disable'));
  const p=createPool('postgresql://u:p@example.com/db'); assert.equal(p.options.ssl.rejectUnauthorized,true); p.end();
});
test('إنشاء الدعوة يأخذ الرقم المرجعي من قاعدة البيانات',async()=>{
  const pool={query:async(sql,args)=>{assert.match(sql,/INSERT INTO zaffa_private.invites/); const payload=JSON.parse(args[1]); assert.equal(payload.status,'draft');return {rows:[{id:args[0],reference_number:'1001',payload}]};}};
  const result=await new PostgresStore(pool).createInvite({data:{groom:'أ',bride:'ب'},email:'a@b.com',template:'garden'});
  assert.equal(result.referenceNumber,1001);assert.match(result.key,/^[a-f0-9]{32}$/);assert.equal(result.status,'draft');
});
test('التحديث يستخدم معاملة وقفل الصف ولا يغيّر الرقم المرجعي',async()=>{
  const calls=[]; const original={id:'abc123',status:'draft',key:'private'};
  const client={query:async(sql,args)=>{calls.push(sql);if(sql.includes('FOR UPDATE'))return {rows:[{id:'abc123',reference_number:'1001',payload:original}]};return {rows:[]};},release:()=>calls.push('release')};
  const store=new PostgresStore({connect:async()=>client});
  const out=await store.updateInvite('abc123',inv=>({...inv,status:'pending'}));
  assert.equal(out.status,'pending');assert.deepEqual(calls.map(x=>x.split(' ')[0]),['BEGIN','SELECT','UPDATE','COMMIT','release']);
  calls.length=0;await assert.rejects(store.updateInvite('abc123',inv=>({...inv,referenceNumber:55})));
  assert.deepEqual(calls.map(x=>x.split(' ')[0]),['BEGIN','SELECT','ROLLBACK','release']);
});
