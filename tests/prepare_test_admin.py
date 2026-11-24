"""ينشئ حسابًا معروفًا للاختبار فقط؛ لا تستخدمه أبدًا على بيانات حقيقية."""
import hashlib,json,os,sys,secrets
from pathlib import Path
if len(sys.argv)!=2: raise SystemExit('الاستخدام: python3 tests/prepare_test_admin.py /path/to/isolated-test-data')
d=Path(sys.argv[1]);d.mkdir(parents=True,exist_ok=True);p=d/'admin-auth.json'
salt=secrets.token_bytes(16);pw=b'Test-password-123!';data={'username':'admin','salt':salt.hex(),'iterations':310000,'digest':hashlib.pbkdf2_hmac('sha256',pw,salt,310000).hex()}
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(data,f)
print('تم إنشاء حساب اختبار فقط. لا تستخدمه في الإنتاج.')
