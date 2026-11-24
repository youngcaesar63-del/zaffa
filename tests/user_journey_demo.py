import asyncio, os
from playwright.async_api import async_playwright
B=os.environ.get('ZAFFA_TEST_URL', 'http://localhost:3011')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch();c=await b.new_context(permissions=['clipboard-read','clipboard-write'],accept_downloads=True,viewport={'width':1280,'height':900});pg=await c.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
  def check(n,v):
   print(('PASS ' if v else 'FAIL ')+n)
   if not v: raise AssertionError(n)
  await pg.goto(B+'/',wait_until='networkidle');check('الرئيسية ١٩ قالباً',await pg.locator('.tpl').count()==19)
  await pg.goto(B+'/create?t=emerald',wait_until='networkidle');check('اختيار القالب عبر الرابط', 'on' in await pg.locator('#tps [data-t=emerald]').get_attribute('class'))
  await pg.locator('#groom').fill('عمر');await pg.locator('#bride').fill('سارة');await pg.locator('#d').fill('2027-02-25');await pg.locator('#tm').fill('19:30');await pg.locator('#venue').fill('قاعة الأفراح');await pg.locator('#address').fill('الخرطوم');await pg.locator('#email').fill('test@example.com');
  await pg.locator('#wRefill').click();check('اقتراح نص',len(await pg.locator('#welcome').input_value())>10);await pg.locator('#wShort').click()
  n=await pg.locator('#prog .prow').count();await pg.locator('#addP').click();check('إضافة فقرة',await pg.locator('#prog .prow').count()==n+1);await pg.locator('#prog [data-del]').last.click();check('حذف فقرة',await pg.locator('#prog .prow').count()==n)
  await pg.locator('#mus [data-play=golden]').click();check('معاينة مقطع موسيقي','playing' in await pg.locator('#mus [data-play=golden]').get_attribute('class'));await pg.locator('#mus [data-play=golden]').click();await pg.locator('#mus [data-id=golden]').click()
  await pg.locator('#mprev').click();check('ملء شاشة المعاينة','on' in await pg.locator('#modal').get_attribute('class'));await pg.locator('#mclose').click();await pg.locator('#reload').click()
  await pg.locator('#go').click();await pg.wait_for_url('**/done?**',timeout=20000);await pg.wait_for_timeout(1000);check('تفعيل الدفع التجريبي','مفعّلة' in await pg.locator('#title').inner_text());
  id=await pg.evaluate("new URL(location.href).searchParams.get('id')");key=await pg.evaluate("new URL(location.href).searchParams.get('k')")
  await pg.locator('#dashBtn').click();await pg.locator('#content').wait_for(state='visible');check('حالة لوحة التحكم','مفعّلة' in await pg.locator('#statusBar').inner_text()); await pg.locator('#copyBtn').click();check('نسخ الرابط',f'/i/{id}' in await pg.evaluate('navigator.clipboard.readText()'))
  async with pg.expect_download() as d: await pg.locator('#cardBtn').click()
  check('تنزيل بطاقة PNG',(await d.value).suggested_filename.endswith('.png'))
  async with pg.expect_download() as d: await pg.locator('#csvBtn').click()
  check('تنزيل قائمة CSV',(await d.value).suggested_filename.endswith('.csv'))
  await pg.goto(f'{B}/i/{id}',wait_until='networkidle');await pg.locator('#seal').click();await pg.wait_for_timeout(1400);check('الموسيقى عند فتح الدعوة','playing' in await pg.locator('#musicBtn').get_attribute('class'));await pg.locator('#musicBtn').click();check('إيقاف الموسيقى','playing' not in await pg.locator('#musicBtn').get_attribute('class'))
  check('تمييز اليوم دون خط دائري',await pg.locator('.cal .dd.hit').count()==1 and await pg.locator('.cal .dd.hit svg').count()==0)
  check('رابط خرائط', 'google' in (await pg.locator('#mapBtn').get_attribute('href')));check('رابط التقويم', 'calendar.google.com' in (await pg.locator('#addCal').get_attribute('href')))
  await pg.locator('#rn').fill('محمد');await pg.locator('#pl').click();await pg.locator('#mi').click();await pg.locator('#rf button[type=submit]').click();await pg.locator('#rdone').wait_for(state='visible');check('إرسال الحضور', 'محمد' in await pg.locator('#rtext').inner_text())
  await pg.goto(f'{B}/create?id={id}&k={key}',wait_until='networkidle');await pg.locator('#venue').fill('قاعة النور');await pg.locator('#go').click();await pg.wait_for_timeout(700);await pg.goto(f'{B}/i/{id}',wait_until='networkidle');check('حفظ تعديل القاعة',await pg.locator('#vName').inner_text()=='قاعة النور')
  check('لا أخطاء جافاسكربت',not errs);await b.close()
asyncio.run(main())
