<?php
/* ==========================================================
   زَفّة — إعدادات الإنتاج (PHP)
   عدّل القيم التالية بعد الرفع على الاستضافة
   ========================================================== */
declare(strict_types=1);

return [
    // ---------- قاعدة البيانات ----------
    'db' => [
        'host' => getenv('DB_HOST') ?: 'localhost',
        'name' => getenv('DB_NAME') ?: 'zaffa',
        'user' => getenv('DB_USER') ?: 'zaffa_user',
        'pass' => getenv('DB_PASS') ?: '',
        'charset' => 'utf8mb4',
    ],

    // مسار خارج جذر الويب لتخزين الموسيقى المرفوعة؛ يجب أن يكون قابلاً للكتابة.
    'music_dir' => getenv('ZAFFA_MUSIC_DIR') ?: dirname(__DIR__) . '/zaffa-private/music',
    'og_dir' => getenv('ZAFFA_OG_DIR') ?: dirname(__DIR__) . '/zaffa-private/og',

    // ---------- الأمان ----------
    // ملف الحساب خارج جذر الموقع، أنشئه عبر scripts/set-admin.js أو أعدّه من استضافة موثوقة.
    'admin_auth_file' => getenv('ZAFFA_ADMIN_AUTH_FILE') ?: dirname(__DIR__) . '/zaffa-private/admin-auth.json',

    // رابط الموقع (بلا / في النهاية)
    'public_url' => getenv('PUBLIC_URL') ?: 'https://example.com',

    // ---------- Stripe ----------
    // اتركه فارغًا لإيقاف البطاقة؛ التفعيل المجاني يتطلب ALLOW_DEMO_CHECKOUT=true لاختبار معزول.
    'stripe_key' => getenv('STRIPE_SECRET_KEY') ?: '',
    'allow_demo_checkout' => getenv('ALLOW_DEMO_CHECKOUT') === 'true',
    'stripe_webhook_secret' => getenv('STRIPE_WEBHOOK_SECRET') ?: '',

    // ---------- التسعير ----------
    'price' => [
        'card'         => (int)(getenv('PRICE_CARD') ?: 300), // السعر الثابت للبطاقة بالسنتات
        'addon'        => 200,    // 2.00$ إضافة دعوات رجال/نساء
        'addon_regular'=> 500,
        'currency'     => 'usd',
    ],

    // ---------- الدفع المحلي (بنكك) ----------
    'sd' => [
        'account'  => getenv('SD_ACCOUNT') ?: '1572914',
        'fawry' => getenv('SD_FAWRY_ACCOUNT') ?: '51665206',
        'ocash' => getenv('SD_OCASH_ACCOUNT') ?: '1029939',
        'name'     => getenv('SD_NAME') ?: 'أحمد أزهري حسين أحمد',
        'whatsapp' => getenv('SD_WHATSAPP') ?: '249123452495',
        'price'    => (int)(getenv('SD_PRICE') ?: 2000000),   // بالقرش = 20,000 ج.س
        'addon'    => 1000000,
        'currency' => 'sdg',
    ],
];
