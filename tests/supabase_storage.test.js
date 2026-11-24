'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseStorage, StorageError } = require('../server/supabase-storage');
const options = {url:'https://example.supabase.co',secretKey:'test-secret'};
test('يرفض الإعدادات والمسارات غير الآمنة', () => {
  assert.throws(() => new SupabaseStorage({...options, url:'http://example.com'}));
  assert.throws(() => new SupabaseStorage({...options, url:'https://example.com/path'}));
  assert.throws(() => new SupabaseStorage({...options, bucket:'../unsafe'}));
  const s = new SupabaseStorage(options);
  assert.throws(() => s.objectUrl('music','../secret'));
  assert.throws(() => s.objectUrl('unknown','abc123'));
});
test('يرفع ملفاً إلى حاوية خاصة عبر طلب خادمي', async () => {
  let captured; const s = new SupabaseStorage({...options, fetchImpl:async (url, init) => {captured={url,init};return new Response('',{status:200});}});
  await s.put('music','abc123',Buffer.from('test'));
  assert.equal(captured.url,'https://example.supabase.co/storage/v1/object/zaffa-private/music/abc123.mp3');
  assert.equal(captured.init.headers.authorization,'Bearer test-secret');
  assert.equal(captured.init.headers['x-upsert'],'true');
  await assert.rejects(s.put('music','abc123',Buffer.alloc(8*1024*1024+1)));
});
test('يقرأ الملفات ويعالج الغياب والخطأ دون كشف المفتاح', async () => {
  let status=200;
  const s=new SupabaseStorage({...options, fetchImpl:async()=>new Response(status===200?'content':null,{status})});
  assert.equal((await s.get('og','abc123')).toString(),'content');
  status=404; assert.equal(await s.get('og','abc123'),null);
  status=500; await assert.rejects(s.get('og','abc123'), e=>e instanceof StorageError && !e.message.includes('test-secret'));
});
test('يرفض الملفات الأكبر من الحد حتى دون ترويسة الحجم', async () => {
  const s=new SupabaseStorage({...options, fetchImpl:async()=>new Response(Buffer.alloc(4_000_001))});
  await assert.rejects(s.get('og','abc123'),StorageError);
});
