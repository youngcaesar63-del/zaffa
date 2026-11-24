"""اختبار حمل محلي على بيانات اختبار فقط. لا تستخدمه على موقع إنتاجي."""
import asyncio, os, time, statistics
from collections import Counter
from urllib.parse import urlparse
import aiohttp

BASE = os.environ.get('ZAFFA_TEST_URL', 'http://localhost:3013').rstrip('/')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise SystemExit('يُسمح فقط بالخادم المحلي المعزول')

def percentile(v, p):
    v = sorted(v)
    return v[min(len(v)-1, int((len(v)-1)*p))] if v else 0

async def main():
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout, connector=aiohttp.TCPConnector(limit=300)) as session:
        async with session.post(BASE+'/api/invites', json={'data':{'groom':'تجربة','bride':'ضغط'},'template':'garden','email':'load@example.com'}) as r:
            assert r.status == 201, (r.status, await r.text())
            invite=await r.json()
        invite_id=invite['id']; key=invite['k']; expected=0
        async with session.post(BASE+'/api/checkout', json={'id':invite_id,'k':key}) as r:
            assert r.status == 200, (r.status,await r.text())
        print('بيئة اختبار محلية؛ عناوين العميل الافتراضية مولّدة باختبار X-Forwarded-For، لا مستخدمين حقيقيين')
        for concurrency, total in [(10,200),(50,500),(100,1000)]:
            sem=asyncio.Semaphore(concurrency); times=[]; statuses=Counter(); successful_posts=0
            async def one(i):
                nonlocal successful_posts
                async with sem:
                    t=time.perf_counter(); headers={'X-Forwarded-For':f'10.{concurrency}.{i//250}.{i%250+1}'}
                    try:
                        if i % 2:
                            async with session.post(f'{BASE}/api/invites/{invite_id}/rsvp',headers=headers,json={'name':f'ضيف {concurrency}-{i}','attending':True,'guests':1}) as r:
                                await r.read();code=r.status
                            if code==201: successful_posts+=1
                        else:
                            async with session.get(f'{BASE}/i/{invite_id}',headers=headers) as r:
                                await r.read();code=r.status
                        statuses[str(code)]+=1
                    except Exception as e:
                        statuses[type(e).__name__]+=1
                    times.append((time.perf_counter()-t)*1000)
            t0=time.perf_counter();await asyncio.gather(*(one(i) for i in range(total)));elapsed=time.perf_counter()-t0
            expected+=successful_posts
            async with session.get(f'{BASE}/api/invites/{invite_id}/dashboard',params={'k':key}) as r:
                assert r.status==200
                d=await r.json()
            count=d['stats']['responses']
            print(f'تزامن={concurrency} طلبات={total} ثوان={elapsed:.2f} طلب/ث={total/elapsed:.1f} p50={statistics.median(times):.1f}ms p95={percentile(times,.95):.1f}ms p99={percentile(times,.99):.1f}ms حالات={dict(statuses)} ردود={count}/{expected}')
            assert statuses == Counter({'200': total // 2, '201': total // 2}), 'فشلت بعض الطلبات؛ تأكد من إعداد وسيط الاختبار المعزول'
            assert count==expected, 'فُقدت بعض الردود'
        # حد المعدل نفسه من IP واحد؛ هذه الطلبات ليست ضمن عينات الأداء أعلاه
        codes=[]
        for i in range(35):
            async with session.post(f'{BASE}/api/invites/{invite_id}/rsvp',headers={'X-Forwarded-For':'192.0.2.1'},json={'name':f'ضيف {i}','attending':True}) as r:
                await r.read();codes.append(r.status)
        print('حد المعدل لـ35 طلبًا من عنوان واحد:',dict(Counter(codes)))
        assert 429 in codes
        print('ملاحظة: الضغط عبر HTTP فقط على Node محلي؛ لا يختبر Stripe أو PHP/MySQL أو الشبكة الخارجية.')

if __name__=='__main__':
    asyncio.run(main())
