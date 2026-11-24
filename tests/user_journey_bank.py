import asyncio, os
from playwright.async_api import async_playwright
B=os.environ.get('ZAFFA_TEST_URL', 'http://localhost:3011')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(); ctx=await browser.new_context(permissions=['clipboard-read','clipboard-write'],accept_downloads=True); pg=await ctx.new_page(); errors=[]; checks=[]
  pg.on('pageerror',lambda e: errors.append(str(e))); pg.on('dialog',lambda dialog: dialog.accept())
  def check(name,v):
   checks.append((name,bool(v))); print(('PASS ' if v else 'FAIL ')+name)
  await pg.goto(B+'/create',wait_until='networkidle'); await pg.wait_for_selector('#tps .tp');
  await pg.locator('#go').click();check('التحقق من الحقول المطلوبة',await pg.locator('#err').is_visible())
  await pg.locator('#groom').fill('أحمد');await pg.locator('#bride').fill('سلمى');await pg.locator('#venue').fill('قاعة الاختبار');await pg.locator('#email').fill('test@example.com');
  await pg.locator('#bkgo').click(); await pg.locator('#bkModal.on').wait_for(state='visible'); check('فتح بنكك', await pg.locator('#bkModal').is_visible())
  ref = await pg.locator('#bkRef').inner_text(); check('رقم مرجعي قبل التحويل', ref.isdigit()); await pg.locator('#bkRefCopy').click(); check('نسخ الرقم المرجعي', await pg.evaluate('navigator.clipboard.readText()') == ref)
  await pg.locator('#bkCopy').click();check('نسخ رقم الحساب',await pg.evaluate('navigator.clipboard.readText()')=='123456')
  await pg.locator('#bkclose').click();check('إلغاء بنكك', 'on' not in await pg.locator('#bkModal').get_attribute('class'))
  await pg.locator('#bkgo').click();await pg.locator('#bkTxn').fill('TEST123');await pg.locator('#bkSender').fill('أحمد');
  await pg.evaluate("window.open = (url) => { window.__shareUrl=url; return null; }")
  await pg.locator('#bkSend').click();await pg.wait_for_url('**/done?**',timeout=15000);await pg.wait_for_timeout(1200)
  check('إرسال طلب بنكك وظهور الانتظار','بانتظار' in await pg.locator('#title').inner_text())
  id=await pg.evaluate("new URL(location.href).searchParams.get('id')");key=await pg.evaluate("new URL(location.href).searchParams.get('k')")
  check('إخفاء المشاركة قبل التفعيل', not await pg.locator('#shareBtn').is_visible() and not await pg.locator('#linkWrap').is_visible())
  check('حظر فتح الدعوة قبل التفعيل', (await ctx.request.get(f'{B}/i/{id}')).status == 403)
  await pg.locator('#dashBtn').click(); await pg.locator('#content').wait_for(state='visible'); check('لوحة الطلب قيد الانتظار','بانتظار' in await pg.locator('#statusBar').inner_text())
  await pg.goto(B+'/admin',wait_until='networkidle');await pg.locator('#username').fill(os.environ.get('ZAFFA_TEST_ADMIN_USER', 'admin'));await pg.locator('#password').fill(os.environ.get('ZAFFA_TEST_ADMIN_PASSWORD', 'Test-password-123!'));await pg.locator('#enter').click();await pg.locator('#panel').wait_for(state='visible');row=pg.locator('#rows tr').filter(has=pg.locator(f'[data-id="{id}"]')); check('ظهور عملية بنكك للإدارة','TEST123' in await row.inner_text());await row.locator('[data-act=activate]').click();await pg.locator(f'[data-id="{id}"][data-act=deactivate]').wait_for();check('تفعيل تحويل من الإدارة',True)
  await pg.goto(f'{B}/dashboard?id={id}&k={key}',wait_until='networkidle');await pg.locator('#content').wait_for(state='visible');await pg.locator('#copyBtn').click();check('نسخ الرابط بعد التفعيل',f'/i/{id}' in await pg.evaluate('navigator.clipboard.readText()'))
  await pg.evaluate("window.open = (url) => { window.__shareUrl=url; return null; }");await pg.locator('#waBtn').click();check('تكوين رابط واتساب بعد التفعيل',await pg.evaluate("window.__shareUrl?.startsWith('https://wa.me/?text=')"))
  await pg.goto(f'{B}/i/{id}',wait_until='networkidle');await pg.locator('#seal').click();await pg.wait_for_timeout(1200);await pg.locator('#rn').fill('ضيف اختبار');await pg.locator('#rf button[type=submit]').click();await pg.locator('#rdone').wait_for(state='visible');await pg.locator('#redit').click();await pg.locator('#seg [data-v=no]').click();await pg.locator('#rf button[type=submit]').click();await pg.locator('#rdone').wait_for(state='visible');
  await pg.locator('#wn').fill('ضيف');await pg.locator('#wm').fill('تهنئة فريدة للاختبار');await pg.locator('#wf button[type=submit]').click();await pg.get_by_text('تهنئة فريدة للاختبار').wait_for();
  await pg.goto(f'{B}/dashboard?id={id}&k={key}',wait_until='networkidle');await pg.locator('#content').wait_for(state='visible');print('نتيجة تعديل الرد: ',[await pg.locator('#'+x).inner_text() for x in ['kResp','kCome','kDecl']]);check('تعديل الرد لا يضيف ردًا مكررًا',await pg.locator('#kResp').inner_text()=='1')
  await pg.locator('[data-p=wishes]').click();await pg.locator('#wishesList [data-del]').click();await pg.wait_for_timeout(700);check('إمكانية استرجاع آخر تهنئة مخفية',await pg.locator('#wishesList [data-del]').count()>0)
  if await pg.locator('#wishesList [data-del]').count():
   await pg.locator('#wishesList [data-del]').click();await pg.wait_for_timeout(700)
   check('إعادة إظهار التهنئة في الدعوة',any(w['message']=='تهنئة فريدة للاختبار' for w in (await (await ctx.request.get(f'{B}/api/invites/{id}/wishes')).json())['wishes']))
  check('عدم ظهور أخطاء جافاسكربت',not errors)
  print('page errors',errors); print('results',sum(v for _,v in checks),'/',len(checks));await browser.close(); assert all(v for _,v in checks), 'فشلت اختبارات رحلة المستخدم'
asyncio.run(main())
