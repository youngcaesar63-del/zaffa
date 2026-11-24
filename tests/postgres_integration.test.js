'use strict';
/* اختبار محلي مع PostgreSQL عبر PGlite؛ لا يستخدم بيانات الموقع. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
const {PostgresStore}=require('../server/postgres-store');

test('مخطط PostgreSQL ودورة الدعوة والرد والتهنئة',async()=>{
 const db=new PGlite();
 try {
  const schema=fs.readFileSync(require('path').join(__dirname,'../supabase/schema.sql'),'utf8');
  await db.exec(schema);await db.exec(schema);
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release:()=>{}}),end:()=>db.close()};
  const store=new PostgresStore(pool);
  const invites=await Promise.all(Array.from({length:30},(_,i)=>store.createInvite({data:{groom:`عريس ${i}`,bride:'عروس'},email:'test@example.com'})));
  const numbers=invites.map(x=>x.referenceNumber).sort((a,b)=>a-b);
  assert.deepEqual(numbers,Array.from({length:30},(_,i)=>1001+i));
  const first=invites[0];assert.equal((await store.get(first.id)).status,'draft');
  assert.equal(await store.addGuestRow('rsvp',first.id,{name:'ضيف'}),null);
  assert.equal(await store.submitTransfer(first.id,'wrong',{txn:'123',sender:'اسم',method:'bankak'}),null);
  for (const [i,method] of ['bankak','fawry','ocash'].entries()) {
    const inv=invites[i]; const request=await store.submitTransfer(inv.id,inv.key,{txn:'123',sender:'اسم',method});
    assert.equal(request.invite.status,'pending');assert.equal(request.invite.bankMethod,method);
  }
  await assert.rejects(store.submitTransfer(first.id,first.key,{txn:'123',sender:'اسم',method:'unknown'}));
  await store.activate(first.id);
  const paidAt=(await store.get(first.id)).paidAt;
  await store.activate(first.id);
  assert.equal((await store.get(first.id)).paidAt,paidAt);
  assert.equal((await store.submitTransfer(first.id,first.key,{txn:'123',sender:'اسم',method:'bankak'})).alreadyActive,true);
  const r=await store.addGuestRow('rsvp',first.id,{name:'ضيف',attending:true,editTokenHash:'hash'});
  const w=await store.addGuestRow('wish',first.id,{name:'ضيف',message:'تهانينا'});
  assert.equal((await store.listRows('rsvp',first.id)).length,1);assert.equal(w.hidden,false);
  await store.updateGuestRow('rsvp',first.id,r.id,row=>({...row,attending:false}),true);
  assert.equal((await store.listRows('rsvp',first.id))[0].attending,false);
  await store.updateGuestRow('wish',first.id,w.id,row=>({...row,hidden:true}));
  assert.equal((await store.listRows('wish',first.id))[0].hidden,true);
  await assert.rejects(store.updateGuestRow('wish',first.id,w.id,row=>({...row,id:'changed'})));
  assert.equal((await store.listRows('wish',first.id))[0].id,w.id);
  await store.setSetting('admin_auth',{username:'admin',digest:'hash'});
  assert.equal((await store.getSetting('admin_auth')).username,'admin');
  assert.equal((await store.listInvites()).length,30);
  const rls=await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='zaffa_private'::regnamespace AND relkind='r'");
  assert.equal(rls.rows.length,4);assert.ok(rls.rows.every(row=>row.relrowsecurity));
 } finally {await db.close()}
});
