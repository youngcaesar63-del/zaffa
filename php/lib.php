<?php
/* ==========================================================
   زَفّة — المكتبة المشتركة
   ========================================================== */
declare(strict_types=1);

/* الإعدادات */
$CFG = require __DIR__ . '/config.php';

/* ---------- اتصال قاعدة البيانات ---------- */
function db(): PDO {
    static $pdo = null;
    global $CFG;
    if ($pdo instanceof PDO) return $pdo;
    $d = $CFG['db'];
    $dsn = "mysql:host={$d['host']};dbname={$d['name']};charset={$d['charset']}";
    try {
        $pdo = new PDO($dsn, $d['user'], $d['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        json_out(500, ['error' => 'تعذّر الاتصال بقاعدة البيانات']);
    }
    return $pdo;
}

/* ---------- استجابات JSON ---------- */
function json_out(int $code, array $data): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    if (!is_array($d)) json_out(400, ['error' => 'invalid json']);
    return $d;
}

function s(string $k, $def = ''): string {
    $v = $_GET[$k] ?? $def;
    return is_string($v) ? trim($v) : (string)$def;
}

function h(?string $v): string {
    return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* ---------- CORS / رؤوس الأمان ---------- */
function security_headers(): void {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

/* ---------- حد المعدل (بسيط، بالمُعرّف المؤقت) ---------- */
function rate_limit(string $bucket, int $max = 20, int $window = 60): bool {
    $dir = sys_get_temp_dir() . '/zaffa_rl';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'x';
    $file = $dir . '/' . preg_replace('/[^a-z0-9_]/i', '', $bucket) . '_' . md5($ip);
    $f = @fopen($file, 'c+');
    if (!$f) return false;
    if (!flock($f, LOCK_EX)) { fclose($f); return false; }
    $now = time(); $j = json_decode((string)stream_get_contents($f), true);
    $data = is_array($j) && isset($j['t']) && $now - (int)$j['t'] < $window ? $j : ['n'=>0, 't'=>$now];
    $data['n'] = (int)$data['n'] + 1;
    rewind($f); ftruncate($f, 0); fwrite($f, json_encode($data)); fflush($f); flock($f, LOCK_UN); fclose($f);
    return $data['n'] <= $max;
}

function ip_hash(): string {
    return substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'x') . '|zaffa'), 0, 32);
}

/* ---------- مفاتيح ---------- */
function make_id(int $len = 8): string {
    $A = 'abcdefghijkmnpqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < $len; $i++) $out .= $A[random_int(0, strlen($A) - 1)];
    return $out;
}
function make_key(): string {
    return bin2hex(random_bytes(16));           // 32 حرفًا
}
function key_hash(string $key): string {
    return hash('sha256', $key);
}

/* ---------- الدعوات ---------- */
function invite_get(string $id): ?array {
    $st = db()->prepare('SELECT * FROM invites WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) return null;
    $r['data'] = json_decode((string)$r['data'], true) ?: [];
    return $r;
}

function invite_auth(array $inv, ?string $key): bool {
    if ($key === null || $key === '') return false;
    return hash_equals((string)$inv['edit_key_hash'], key_hash($key));
}

function require_edit_key(array $inv): void {
    $k = $_SERVER['HTTP_X_EDIT_KEY'] ?? ($_GET['k'] ?? null);
    if (!invite_auth($inv, is_string($k) ? $k : null)) json_out(403, ['error' => 'forbidden']);
}

function admin_auth_config(): ?array {
    global $CFG;
    $a = json_decode((string)@file_get_contents($CFG['admin_auth_file']), true);
    if (!is_array($a) || !preg_match('/^[A-Za-z0-9_.-]{3,40}$/D', (string)($a['username'] ?? '')) ||
        !is_int($a['iterations'] ?? null) || $a['iterations'] < 310000 || $a['iterations'] > 2000000 ||
        !preg_match('/^[0-9a-f]{32}$/Di', (string)($a['salt'] ?? '')) ||
        !preg_match('/^[0-9a-f]{64}$/Di', (string)($a['digest'] ?? ''))) return null;
    return $a;
}
function admin_password_valid($password, array $a): bool {
    if (!is_string($password) || strlen($password) > 800) return false;
    $hash = hash_pbkdf2('sha256', $password, hex2bin($a['salt']), $a['iterations'], 64);
    return hash_equals($a['digest'], $hash);
}
function admin_session_start(): void {
    global $CFG;
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');
    session_name('zaffa_admin_session');
    session_set_cookie_params(['lifetime'=>0, 'path'=>'/', 'secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' || str_starts_with($CFG['public_url'], 'https://'), 'httponly'=>true, 'samesite'=>'Strict']);
    session_start();
}
function require_admin(bool $csrf = false): void {
    admin_session_start(); $a = admin_auth_config();
    if (!$a || empty($_SESSION['admin_expires']) || $_SESSION['admin_expires'] <= time() ||
        !hash_equals($a['digest'], (string)($_SESSION['admin_fingerprint'] ?? ''))) json_out(401, ['error'=>'سجّل الدخول إلى لوحة الإدارة']);
    if ($csrf && !hash_equals((string)($_SESSION['admin_csrf'] ?? ''), (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) json_out(403, ['error'=>'تعذّر التحقق من الجلسة']);
}
function admin_clear_session(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires'=>time()-3600,'path'=>$p['path'],'domain'=>$p['domain'],'secure'=>$p['secure'],'httponly'=>true,'samesite'=>'Strict']);
    }
    session_destroy();
}

/* ---------- الأسعار ---------- */
function sold_count(): int {
    $st = db()->query("SELECT val FROM counters WHERE name = 'sold'");
    $r = $st->fetch();
    return $r ? (int)$r['val'] : 0;
}

function price_info(): array {
    global $CFG;
    $p = $CFG['price'];
    $sold = sold_count();
    return [
        'amount'   => $p['card'],
        'addon'    => $p['addon'],
        'addonRegular' => $p['addon_regular'],
        'currency' => $p['currency'],
        'sold'     => $sold,
        'demoMode' => $CFG['stripe_key'] === '',
        'demoCheckoutEnabled' => $CFG['stripe_key'] === '' && $CFG['allow_demo_checkout'],
        'cardAvailable' => $CFG['stripe_key'] !== '' && $CFG['stripe_webhook_secret'] !== '',
        'sd'       => $CFG['sd']['account'] !== '' ? [
            'price'    => $CFG['sd']['price'],
            'addon'    => $CFG['sd']['addon'],
            'currency' => $CFG['sd']['currency'],
            'name'     => $CFG['sd']['name'],
            'account'  => $CFG['sd']['account'],
            'whatsapp' => $CFG['sd']['whatsapp'],
            'methods' => array_values(array_filter([
                ['id'=>'bankak', 'name'=>'بنكك', 'account'=>$CFG['sd']['account']],
                ['id'=>'fawry', 'name'=>'فوري', 'account'=>$CFG['sd']['fawry']],
                ['id'=>'ocash', 'name'=>'أوكاش', 'account'=>$CFG['sd']['ocash']],
            ], fn($m) => $m['account'] !== '')),
        ] : null,
    ];
}

/* ---------- تفعيل الدعوة ---------- */
function activate_invite(array $inv): void {
    if ($inv['status'] === 'active') {
        db()->prepare('UPDATE invites SET paid_at = NOW() WHERE id = ?')->execute([$inv['id']]);
        return;
    }
    db()->prepare("UPDATE invites SET status = 'active', paid_at = NOW() WHERE id = ?")->execute([$inv['id']]);
    db()->exec("UPDATE counters SET val = val + 1 WHERE name = 'sold'");
}

/* ---------- قوالب الثيمات ---------- */
function themes(): array {
    return [
        'garden'  => ['accent'=>'#c9798c','deep'=>'#7d2f47','soft'=>'#fdeef2','gold'=>['#e8b8c4','#c9798c','#9c4a63'],'hero'=>'/assets/hero/garden.webp','phrase'=>'بين الورد والفرح، ندعوكم لمشاركتنا حفل زفافنا','side'=>''],
        'saudi'   => ['accent'=>'#b8912f','deep'=>'#4a3a1a','soft'=>'#fdf7e8','gold'=>['#e2c274','#b8912f','#8a6a1c'],'hero'=>'/assets/hero/saudi.webp','phrase'=>'بكل سرور نتشرّف بدعوتكم لحضور حفل زواجنا','side'=>''],
        'crystal' => ['accent'=>'#7c8794','deep'=>'#2b333d','soft'=>'#f2f5f8','gold'=>['#c3ccd6','#8e99a5','#5f6873'],'hero'=>'/assets/hero/crystal.webp','phrase'=>'في أمسيةٍ مضيئة، يسعدنا أن تشاركونا حفل زفافنا','side'=>''],
        'henna-groom' => ['accent'=>'#b9985e','deep'=>'#4b101c','soft'=>'#fff7eb','gold'=>['#f1dbab','#c69d61','#8b6a34'],'hero'=>'/assets/hero/henna-groom.webp','phrase'=>'يا مرحب بالأحباب في ليلة حنة العريس','side'=>'m'],
        'jirtig'  => ['accent'=>'#a92c2e','deep'=>'#591c22','soft'=>'#fff8ed','gold'=>['#e2c27f','#aa3033','#7a2526'],'hero'=>'/assets/hero/jirtig.webp','phrase'=>'على محبة الأهل ولمّة الأحباب، ندعوكم إلى ليلة الجرتق','side'=>''],
        'sudan'   => ['accent'=>'#b5642e','deep'=>'#5a2a12','soft'=>'#fdf1e6','gold'=>['#e0a662','#b5642e','#8a4520'],'hero'=>'/assets/hero/sudan.webp','phrase'=>'بفرحة سودانية أصيلة، ندعوكم لمشاركتنا ليلة الجرتق','side'=>''],
        'saudi-m' => ['accent'=>'#b8912f','deep'=>'#3a2f14','soft'=>'#fbf6e9','gold'=>['#e2c274','#b8912f','#8a6a1c'],'hero'=>'/assets/hero/men.webp','phrase'=>'بكل اعتزاز، نتشرّف بدعوتكم لحضور حفل الزواج','side'=>'m'],
        'saudi-w' => ['accent'=>'#c9798c','deep'=>'#7d2f47','soft'=>'#fdeef2','gold'=>['#e8b8c4','#c9798c','#9c4a63'],'hero'=>'/assets/hero/women.webp','phrase'=>'بكل محبة، يسعدنا دعوتكنّ لمشاركتنا حفل الزفاف','side'=>'w'],
        'levant'  => ['accent'=>'#3f7d6e','deep'=>'#1e4438','soft'=>'#eef7f3','gold'=>['#c8dfc9','#3f7d6e','#245a4a'],'hero'=>'/assets/hero/levant.webp','phrase'=>'بمحبةٍ كبيرة، ندعوكم لمشاركتنا فرحة زفافنا','side'=>''],
        'ivory' => ['accent'=>'#a8802f','deep'=>'#4a3c24','soft'=>'#fbf6ec','gold'=>['#dcbc76','#a8802f','#7a5a1c'],'hero'=>'/assets/hero/ivory.webp','phrase'=>'بكل محبة، نتشرّف بدعوتكم لمشاركتنا حفل زفافنا','side'=>''],
        'velvet' => ['accent'=>'#a8324a','deep'=>'#4a0d18','soft'=>'#fdf0f2','gold'=>['#d9a4a4','#a8324a','#6d1424'],'hero'=>'/assets/hero/velvet.webp','phrase'=>'في ليلةٍ تليق بالمحبة، ندعوكم لمشاركتنا فرحة زفافنا','side'=>''],
        'thuluth' => ['accent'=>'#c9a227','deep'=>'#1a1608','soft'=>'#faf6e8','gold'=>['#e8cf7a','#c9a227','#8a6c10'],'hero'=>'/assets/hero/thuluth.webp','phrase'=>'بأجمل عبارات الود، نتشرّف بدعوتكم لحفل زفافنا','side'=>''],
        'sunset' => ['accent'=>'#c2547e','deep'=>'#3d1f45','soft'=>'#fdf1f6','gold'=>['#e8a0bd','#c2547e','#8a3358'],'hero'=>'/assets/hero/sunset.webp','phrase'=>'بألوان الفرح، ندعوكم لمشاركتنا حفل زفافنا','side'=>''],
        'blossom' => ['accent'=>'#6b8fb5','deep'=>'#2b4157','soft'=>'#f2f7fb','gold'=>['#a9c3d9','#6b8fb5','#456b8f'],'hero'=>'/assets/hero/blossom.webp','phrase'=>'كما يتفتح الزهر، تبدأ حكايتنا بحضوركم','side'=>''],
        'marble' => ['accent'=>'#9a8149','deep'=>'#332c1e','soft'=>'#faf8f4','gold'=>['#d4c08a','#9a8149','#6b5a30'],'hero'=>'/assets/hero/marble.webp','phrase'=>'بكل ودّ، ندعوكم للاحتفاء معنا بحفل زفافنا','side'=>''],
        'emerald' => ['accent'=>'#1f6b52','deep'=>'#0d3327','soft'=>'#eef7f3','gold'=>['#c9b872','#1f6b52','#0f4a37'],'hero'=>'/assets/hero/emerald.webp','phrase'=>'بفرحٍ يليق بكم، نتشرّف بدعوتكم لحفل زفافنا','side'=>''],
        'terracotta' => ['accent'=>'#b26237','deep'=>'#4a2412','soft'=>'#fdf3ec','gold'=>['#dda070','#b26237','#82421f'],'hero'=>'/assets/hero/terracotta.webp','phrase'=>'من دفء اللمة، ندعوكم لمشاركتنا حفل زفافنا','side'=>''],
        'linen' => ['accent'=>'#8a7a63','deep'=>'#3d362b','soft'=>'#f8f5ef','gold'=>['#c4b49c','#8a7a63','#5f5445'],'hero'=>'/assets/hero/linen.webp','phrase'=>'بكل بساطة ومحبة، ندعوكم لمشاركتنا حفل زفافنا','side'=>''],
        'lantern' => ['accent'=>'#c99a3f','deep'=>'#101d33','soft'=>'#f4f7fb','gold'=>['#e6c583','#c99a3f','#8a6a22'],'hero'=>'/assets/hero/lantern.webp','phrase'=>'بنور المحبة، ندعوكم لمشاركتنا حفل زفافنا','side'=>''],
    ];
}

/* ---------- عرض الدعوة ---------- */
function render_invite(array $inv): string {
    $T = themes();
    $tpl = $T[$inv['template']] ?? $T['garden'];
    $payload = array_merge($inv['data'], [
        'id'       => $inv['id'],
        'template' => $inv['template'],
        'theme'    => [
            'id'     => $inv['template'],
            'accent' => $tpl['accent'], 'deep' => $tpl['deep'], 'soft' => $tpl['soft'],
            'gold'   => $tpl['gold'],   'hero' => $tpl['hero'], 'phrase' => $tpl['phrase'],
            'side'   => $tpl['side'],
        ],
    ]);
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    // منع كسر السكربت
    $json = str_replace(['<', '>', "\u{2028}", "\u{2029}"], ['\u003c', '\u003e', '\u2028', '\u2029'], $json);

    // ابحث عن القالب في المسارات المحتملة (حسب طريقة الرفع)
    $candidates = [
        __DIR__ . '/invite.html',              // الكل في جذر الموقع
        __DIR__ . '/../public/invite.html',    // php/ و public/ متجاوران
        __DIR__ . '/../invite.html',
        dirname(__DIR__) . '/invite.html',
    ];
    $tplFile = null;
    foreach ($candidates as $c) {
        if (is_readable($c)) { $tplFile = $c; break; }
    }
    if ($tplFile === null) {
        http_response_code(500);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><h1>ملف القالب invite.html غير موجود</h1>'
           . '<p>تأكد من رفع محتويات مجلد <code>public/</code> إلى جذر الموقع بجانب ملفات PHP.</p>';
        exit;
    }
    $html = (string)file_get_contents($tplFile);
    return str_replace(
        ['/*__INVITE__*/null', '__THEME_ACCENT__', '__THEME_DEEP__', '__THEME_SOFT__', '__TITLE__', '__OG_IMAGE__'],
        [$json, $tpl['accent'], $tpl['deep'], $tpl['soft'],
         h(($tpl['side'] === 'm' ? ($inv['data']['groom'] ?? 'العريس') : ($tpl['side'] === 'w' ? ($inv['data']['bride'] ?? 'العروس') : (($inv['data']['groom'] ?? 'العريس') . ' و ' . ($inv['data']['bride'] ?? 'العروس')))) . ($inv['template'] === 'henna-groom' ? ' — دعوة حنة العريس' : ' — دعوة زفاف')), h(rtrim((string)$GLOBALS['CFG']['public_url'], '/') . '/og/' . $inv['id'] . '.png')],
        $html
    );
}

/* ---------- صورة المشاركة OG (SVG) ---------- */
function og_svg(array $inv): string {
    $T = themes();
    $tpl = $T[$inv['template']] ?? $T['garden'];
    $d = $inv['data'];
    $g = h($d['groom'] ?? 'العريس');
    $b = h($d['bride'] ?? 'العروس');
    $venue = h($d['venue'] ?? '');
    $dateTxt = '';
    if (preg_match('/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/', (string)($d['date'] ?? ''), $m)) {
        $months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
        $dateTxt = (int)$m[3] . ' ' . $months[(int)$m[2] - 1] . ' ' . $m[1];
    }
    $phrase = h($tpl['phrase']);
    return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{$tpl['soft']}"/><stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{$tpl['gold'][0]}"/><stop offset=".5" stop-color="{$tpl['gold'][1]}"/><stop offset="1" stop-color="{$tpl['gold'][2]}"/>
  </linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="url(#gold)" stroke-width="3" opacity=".55"/>
<text x="600" y="150" text-anchor="middle" font-family="Amiri,serif" font-size="34" fill="{$tpl['deep']}" opacity=".75">بسم الله الرحمن الرحيم</text>
<text x="600" y="215" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="26" fill="{$tpl['accent']}">{$phrase}</text>
<text x="600" y="350" text-anchor="middle" font-family="Amiri,serif" font-size="86" font-weight="700" fill="{$tpl['deep']}">{$g}</text>
<text x="600" y="410" text-anchor="middle" font-family="Amiri,serif" font-size="40" fill="{$tpl['gold'][1]}">و</text>
<text x="600" y="490" text-anchor="middle" font-family="Amiri,serif" font-size="86" font-weight="700" fill="{$tpl['deep']}">{$b}</text>
<line x1="420" y1="530" x2="560" y2="530" stroke="{$tpl['gold'][1]}" stroke-width="2" opacity=".7"/>
<line x1="640" y1="530" x2="780" y2="530" stroke="{$tpl['gold'][1]}" stroke-width="2" opacity=".7"/>
<text x="600" y="546" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="28" fill="{$tpl['accent']}">{$dateTxt}</text>
<text x="600" y="586" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="22" fill="{$tpl['deep']}" opacity=".6">{$venue}</text>
</svg>
SVG;
}

/* ---------- Stripe ---------- */
function stripe_post(string $endpoint, array $form): array {
    global $CFG;
    $ch = curl_init('https://api.stripe.com/v1/' . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($form),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $CFG['stripe_key']],
        CURLOPT_TIMEOUT        => 25,
    ]);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = json_decode((string)$res, true);
    if ($code >= 400 || !is_array($j)) {
        throw new RuntimeException($j['error']['message'] ?? 'stripe error');
    }
    return $j;
}

function stripe_get(string $endpoint): array {
    global $CFG;
    $ch = curl_init('https://api.stripe.com/v1/' . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $CFG['stripe_key']],
        CURLOPT_TIMEOUT        => 25,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    $j = json_decode((string)$res, true);
    return is_array($j) ? $j : [];
}
