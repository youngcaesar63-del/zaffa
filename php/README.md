# نسخة الإنتاج — PHP + MySQL

هذه النسخة تعمل على **Hostinger** أو أي استضافة PHP 8+ مشتركة.

## ارفع هذه الملفات إلى `public_html`
```
api.php  lib.php  invite.php  og.php  config.php  .htaccess
```

## وارفع محتويات `../public/` إلى **نفس المجلد**
```
index.html  create.html  dashboard.html  done.html  admin.html  invite.html
assets/
```

## ثم
1. أنشئ قاعدة بيانات MySQL واستورد `schema.sql`
2. اضبط بيانات القاعدة و`public_url`، وأنشئ ملف حساب المدير خارج جذر الويب كما هو مشروح في README الرئيسي.
3. فعّل SSL وأجبر HTTPS

> التفاصيل الكاملة في `../README.md` القسم ٥

## تحقق سريع
- `https://موقعك/api/stats` → يجب أن يرجع JSON
- `https://موقعك/create` → صفحة الإنشاء
- `https://موقعك/admin` → لوحة الإدارة

## حدود الاختبار
نسخة PHP تستخدم MySQL، وليس SQLite. فُحصت صياغتها واختُبرت المصادقة بمعزل عن قاعدة البيانات، لكن يجب اختبار الترحيلات والرحلات ورفع الصور والموسيقى وإعادة كتابة Apache على استضافة فعلية قبل النشر. لا تُفعّل الدفع التجريبي في الإنتاج.
