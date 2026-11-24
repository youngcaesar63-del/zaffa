import asyncio, os
from pathlib import Path
from playwright.async_api import async_playwright
B=os.environ.get('ZAFFA_TEST_URL', 'http://localhost:3011'); ROOT=str(Path(__file__).resolve().parents[1])
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch();c=await b.new_context();pg=await c.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
  await pg.goto(B+'/create',wait_until='networkidle'); await pg.locator('#groom').fill('أحمد'); await pg.locator('#bride').fill('ريم');await pg.locator('#venue').fill('قاعة'); await pg.locator('#email').fill('qa@example.com')
  await pg.locator('#musicFile').set_input_files(ROOT+'/public/assets/music/golden.mp3');print('file selected:',await pg.locator('#musicFileStatus').inner_text()); assert await pg.locator('#musicPreview').is_visible();
  await pg.locator('#go').click();await pg.wait_for_url('**/done?**',timeout=20000);id=await pg.evaluate("new URL(location.href).searchParams.get('id')");k=await pg.evaluate("new URL(location.href).searchParams.get('k')"); print('created demo');
  info=await (await c.request.get(f'{B}/api/invites/{id}?k={k}')).json(); assert info['data']['music']=='custom';r=await c.request.get(f'{B}/api/invites/{id}/music');assert r.status==200 and await r.body()==open(ROOT+'/public/assets/music/golden.mp3','rb').read();print('stored file exact bytes, setting custom')
  r=await c.request.post(f'{B}/api/invites/{id}/music',data=b'bad data'*100,headers={'x-edit-key':'wrong','content-type':'audio/mpeg'});assert r.status==403;print('wrong key rejected')
  r=await c.request.post(f'{B}/api/invites/{id}/music',data=b'bad data'*100,headers={'x-edit-key':k,'content-type':'audio/mpeg'});assert r.status==400;print('invalid file rejected')
  r=await c.request.post(f'{B}/api/invites/{id}/music',data=b'x'*(8*1024*1024+1),headers={'x-edit-key':k,'content-type':'audio/mpeg'});assert r.status==413;print('oversized file rejected')
  await pg.goto(f'{B}/i/{id}',wait_until='networkidle'); requests=[];pg.on('response',lambda r: requests.append((r.url,r.status)) if r.url.endswith('/music') else None);await pg.locator('#seal').click();await pg.wait_for_timeout(1200);print('guest request:',requests);assert any('/music' in u and v==200 for u,v in requests); print('audio paused:',await pg.evaluate('au.paused'));assert not await pg.evaluate('au.paused');await pg.locator('#musicBtn').click(); await pg.wait_for_timeout(850); assert await pg.evaluate('au.paused');print('guest plays and pauses music')
  await pg.goto(f'{B}/create?id={id}&k={k}',wait_until='networkidle');assert 'الموسيقى الخاصة محفوظة' in await pg.locator('#musicFileStatus').inner_text();await pg.locator('#musicFile').set_input_files(ROOT+'/public/assets/music/breeze.mp3');await pg.locator('#go').click();await pg.get_by_text('تم رفع الموسيقى الخاصة ✓').wait_for(timeout=10000);r=await c.request.get(f'{B}/api/invites/{id}/music');assert await r.body()==open(ROOT+'/public/assets/music/breeze.mp3','rb').read(); print('replacement succeeds')
  await pg.locator('#mus [data-id=golden]').click();await pg.locator('#go').click();await pg.wait_for_timeout(1000);info=await (await c.request.get(f'{B}/api/invites/{id}?k={k}')).json();assert info['data']['music']=='golden';print('switch to existing preset works');print('errors:',errs);assert not errs; await b.close()
asyncio.run(main())
