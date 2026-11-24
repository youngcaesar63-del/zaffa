<?php
/* ==========================================================
   زَفّة — نقطة النهاية الموحّدة للـAPI (PHP)
   تُستخدم عبر .htaccess:  /api/...  →  api.php?__p=...
   ========================================================== */
declare(strict_types=1);

require __DIR__ . '/lib.php';
security_headers();

$CFG = require __DIR__ . '/config.php';

/* المسار: إمّا من rewrite أو من ?__p= */
$path = $_GET['__p'] ?? '';
if ($path === '') {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = preg_replace('#^/api/?#', '', $uri);
}
$path = '/' . trim((string)$path, '/');
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

/* تسجيل دخول المدير وجلسة آمنة */
if ($path === '/admin/login' && $method === 'POST') {
    if (!rate_limit('admin_login', 8)) json_out(429, ['error'=>'محاولات كثيرة، حاول بعد دقيقة']);
    $a = admin_auth_config();
    if (!$a) json_out(503, ['error'=>'حساب الإدارة غير مهيأ؛ تواصل مع مسؤول الخادم']);
    $b = body_json(); $valid = admin_password_valid($b['password'] ?? null, $a);
    if (!hash_equals($a['username'], (string)($b['username'] ?? '')) || !$valid) json_out(401, ['error'=>'اسم المستخدم أو كلمة المرور غير صحيحة']);
    admin_session_start(); session_regenerate_id(true);
    $_SESSION['admin_expires'] = time() + 8 * 3600;
    $_SESSION['admin_fingerprint'] = $a['digest']; $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
    json_out(200, ['ok'=>true, 'csrf'=>$_SESSION['admin_csrf']]);
}
if ($path === '/admin/session' && $method === 'GET') {
    require_admin(); json_out(200, ['ok'=>true, 'csrf'=>$_SESSION['admin_csrf']]);
}
if ($path === '/admin/logout' && $method === 'POST') {
    require_admin(true); admin_clear_session(); json_out(200, ['ok'=>true]);
}
if ($path === '/admin/password' && $method === 'POST') {
    require_admin(true);
    if (!rate_limit('admin_password', 5)) json_out(429, ['error'=>'محاولات كثيرة، حاول بعد دقيقة']);
    $b = body_json(); $a = admin_auth_config();
    if (!$a || !admin_password_valid($b['currentPassword'] ?? null, $a)) json_out(403, ['error'=>'كلمة المرور الحالية غير صحيحة']);
    $pw = $b['newPassword'] ?? null;
    if (!is_string($pw) || mb_strlen($pw) < 12 || mb_strlen($pw) > 200) json_out(400, ['error'=>'كلمة المرور الجديدة يجب أن تكون من ١٢ إلى ٢٠٠ حرف']);
    $new = ['username'=>$a['username'], 'iterations'=>310000, 'salt'=>bin2hex(random_bytes(16))];
    $new['digest'] = hash_pbkdf2('sha256', $pw, hex2bin($new['salt']), $new['iterations'], 64);
    $file = $CFG['admin_auth_file']; $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
    if (@file_put_contents($tmp, json_encode($new), LOCK_EX) === false) json_out(500, ['error'=>'تعذّر حفظ كلمة المرور']);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $file)) { @unlink($tmp); json_out(500, ['error'=>'تعذّر حفظ كلمة المرور']); }
    admin_clear_session(); json_out(200, ['ok'=>true]);
}

/* ============================ /stats ============================ */
if ($path === '/stats' && $method === 'GET') {
    json_out(200, price_info());
}

/* ============================ /invites ============================ */
if ($path === '/invites' && $method === 'POST') {
    if (!rate_limit('create', 15)) json_out(429, ['error' => 'محاولات كثيرة، حاول بعد قليل']);
    $b = body_json();
    $data = $b['data'] ?? null;
    $requestedTheme = themes()[(string)($b['template'] ?? 'garden')] ?? themes()['garden'];
    if (!is_array($data) || ($requestedTheme['side'] !== 'w' && trim((string)($data['groom'] ?? '')) === '') || ($requestedTheme['side'] !== 'm' && trim((string)($data['bride'] ?? '')) === '')) {
        json_out(400, ['error' => 'الأسماء مطلوبة']);
    }
    $email = trim((string)($b['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_out(400, ['error' => 'بريد إلكتروني غير صحيح']);
    }
    $tpl = (string)($b['template'] ?? 'garden');
    if (!isset(themes()[$tpl])) $tpl = 'garden';

    $id = make_id(8);
    $key = make_key();
    $st = db()->prepare(
        "INSERT INTO invites (id, edit_key_hash, status, template, data, email)
         VALUES (?, ?, 'draft', ?, ?, ?)"
    );
    $st->execute([
        $id,
        key_hash($key),
        $tpl,
        json_encode($data, JSON_UNESCAPED_UNICODE),
        $email !== '' ? $email : null,
    ]);
    json_out(201, ['id' => $id, 'k' => $key, 'status' => 'draft', 'referenceNumber' => (int)db()->lastInsertId()]);
}

/* ============================ /invites/{id} ============================ */
if (preg_match('#^/invites/([a-z0-9]+)(/.*)?$#', $path, $m)) {
    $id  = $m[1];
    $sub = $m[2] ?? '';
    $inv = invite_get($id);
    if (!$inv) json_out(404, ['error' => 'not found']);
    if ($inv['status'] !== 'active' && (($sub === '/rsvp' && $method === 'POST') ||
        ($sub === '/wishes' && in_array($method, ['GET', 'POST'], true)))) {
        json_out(403, ['error' => 'الدعوة غير مفعّلة بعد']);
    }

    /* GET /invites/{id}?k= */
    if ($sub === '' && $method === 'GET') {
        if (!invite_auth($inv, s('k'))) json_out(403, ['error' => 'forbidden']);
        json_out(200, [
            'id'       => $inv['id'],
            'referenceNumber' => (int)$inv['reference_number'],
            'status'   => $inv['status'],
            'template' => $inv['template'],
            'data'     => $inv['data'],
            'email'    => $inv['email'],
            'addon'    => (bool)$inv['addon'],
        ]);
    }

    /* PUT /invites/{id} */
    if ($sub === '' && ($method === 'PUT' || $method === 'PATCH')) {
        require_edit_key($inv);
        $b = body_json();
        $newData = $b['data'] ?? $inv['data'];
        $newTpl  = $inv['template'];
        if (!empty($b['template']) && $inv['status'] !== 'active' && isset(themes()[$b['template']])) {
            $newTpl = $b['template'];
        }
        $addon = isset($b['addon']) ? ((bool)$b['addon'] ? 1 : 0) : (int)$inv['addon'];
        db()->prepare('UPDATE invites SET data = ?, template = ?, addon = ? WHERE id = ?')
            ->execute([json_encode($newData, JSON_UNESCAPED_UNICODE), $newTpl, $addon, $id]);
        json_out(200, ['ok' => true, 'status' => $inv['status']]);
    }

    /* صورة المشاركة؛ تُحفظ خارج الويب وتُعرض فقط للدعوة المفعّلة. */
    if ($sub === '/og' && $method === 'POST') {
        require_edit_key($inv);
        if (!rate_limit('og_' . $id, 15)) json_out(429, ['error'=>'محاولات كثيرة']);
        $max = 4000000;
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) json_out(413, ['error'=>'حجم الصورة كبير']);
        $stream = fopen('php://input', 'rb'); $raw = stream_get_contents($stream, $max + 1); fclose($stream);
        if ($raw === false || strlen($raw) > $max) json_out(413, ['error'=>'حجم الصورة كبير']);
        if (strlen($raw) <= 8 || substr($raw,0,8) !== "\x89PNG\r\n\x1a\n") json_out(400, ['error'=>'الصورة يجب أن تكون PNG']);
        $dir = $CFG['og_dir'];
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) json_out(500, ['error'=>'تعذر حفظ الصورة']);
        $file = $dir . '/' . $id . '.png'; $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
        if (file_put_contents($tmp, $raw, LOCK_EX) === false || !rename($tmp, $file)) { @unlink($tmp); json_out(500, ['error'=>'تعذر حفظ الصورة']); }
        @chmod($file, 0600); json_out(200, ['ok'=>true, 'bytes'=>strlen($raw)]);
    }

    /* موسيقى مخصصة: لا يُكشف مسار التخزين للعميل */
    if ($sub === '/music' && $method === 'POST') {
        require_edit_key($inv);
        if (!rate_limit('music_' . $id, 15)) json_out(429, ['error' => 'محاولات كثيرة']);
        $max = 8 * 1024 * 1024;
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) json_out(413, ['error' => 'حجم الموسيقى أكبر من ٨ ميغابايت']);
        $stream = fopen('php://input', 'rb');
        $raw = stream_get_contents($stream, $max + 1);
        fclose($stream);
        if ($raw === false || strlen($raw) > $max) json_out(413, ['error' => 'حجم الموسيقى أكبر من ٨ ميغابايت']);
        $valid = strlen($raw) > 128 && (substr($raw, 0, 3) === 'ID3' ||
            (ord($raw[0]) === 0xff && (ord($raw[1]) & 0xe0) === 0xe0 && (ord($raw[1]) & 0x18) !== 0x08 && (ord($raw[1]) & 0x06) !== 0));
        if (!$valid) json_out(400, ['error' => 'الملف ليس MP3 صالحًا']);
        $dir = $CFG['music_dir'];
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) json_out(500, ['error' => 'تعذر حفظ الموسيقى']);
        $file = $dir . '/' . $id . '.mp3';
        $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
        if (file_put_contents($tmp, $raw, LOCK_EX) === false || !rename($tmp, $file)) {
            @unlink($tmp); json_out(500, ['error' => 'تعذر حفظ الموسيقى']);
        }
        json_out(200, ['ok' => true]);
    }
    if ($sub === '/music' && $method === 'GET') {
        if ($inv['status'] !== 'active') require_edit_key($inv);
        $file = $CFG['music_dir'] . '/' . $id . '.mp3';
        if (!is_file($file)) json_out(404, ['error' => 'لا توجد موسيقى مرفوعة']);
        header('Content-Type: audio/mpeg');
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($file); exit;
    }

    /* POST /invites/{id}/rsvp */
    if ($sub === '/rsvp' && $method === 'POST') {
        if (!rate_limit('rsvp_' . $id, 30)) json_out(429, ['error' => 'محاولات كثيرة']);
        $b = body_json();
        $name = trim((string)($b['name'] ?? ''));
        if ($name === '') json_out(400, ['error' => 'الاسم مطلوب']);
        $guests = max(1, min(10, (int)($b['guests'] ?? 1)));
        $side = in_array(($b['side'] ?? ''), ['m', 'w'], true) ? $b['side'] : null;
        $values = [mb_substr($name, 0, 80), !empty($b['attending']) ? 1 : 0, $guests,
            mb_substr(trim((string)($b['note'] ?? '')), 0, 300), $side];
        if (!empty($b['responseId']) || !empty($b['editToken'])) {
            $responseId = (string)($b['responseId'] ?? '');
            $hash = hash('sha256', (string)($b['editToken'] ?? ''));
            $st = db()->prepare('SELECT id FROM rsvps WHERE id = ? AND invite_id = ? AND edit_token_hash = ?');
            $st->execute([$responseId, $id, $hash]);
            if (!$st->fetch()) json_out(403, ['error' => 'تعذر تعديل الرد']);
            db()->prepare('UPDATE rsvps SET name = ?, attending = ?, guests = ?, note = ?, side = ? WHERE id = ? AND invite_id = ? AND edit_token_hash = ?')
                ->execute([...$values, $responseId, $id, $hash]);
            json_out(200, ['ok' => true, 'id' => $responseId]);
        }
        $token = bin2hex(random_bytes(32));
        db()->prepare('INSERT INTO rsvps (invite_id, name, attending, guests, note, side, ip_hash, edit_token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, ...$values, ip_hash(), hash('sha256', $token)]);
        json_out(201, ['ok' => true, 'id' => (string)db()->lastInsertId(), 'editToken' => $token]);
    }

    /* GET|POST /invites/{id}/wishes */
    if ($sub === '/wishes' && $method === 'GET') {
        $st = db()->prepare(
            'SELECT id, name, message, created_at FROM wishes
             WHERE invite_id = ? AND hidden = 0 ORDER BY id ASC LIMIT 200'
        );
        $st->execute([$id]);
        $rows = array_map(fn($r) => [
            'id' => (string)$r['id'], 'name' => $r['name'],
            'message' => $r['message'], 'createdAt' => $r['created_at'],
        ], $st->fetchAll());
        json_out(200, ['wishes' => $rows]);
    }
    if ($sub === '/wishes' && $method === 'POST') {
        if (!rate_limit('wish_' . $id, 20)) json_out(429, ['error' => 'محاولات كثيرة']);
        $b = body_json();
        $name = trim((string)($b['name'] ?? ''));
        $msg  = trim((string)($b['message'] ?? ''));
        if ($name === '' || $msg === '') json_out(400, ['error' => 'الاسم والرسالة مطلوبان']);
        db()->prepare('INSERT INTO wishes (invite_id, name, message, ip_hash) VALUES (?, ?, ?, ?)')
            ->execute([$id, mb_substr($name, 0, 60), mb_substr($msg, 0, 300), ip_hash()]);
        json_out(201, ['ok' => true]);
    }

    /* DELETE /invites/{id}/wishes/{wid} */
    if (preg_match('#^/wishes/(\d+)$#', $sub, $mw) && $method === 'DELETE') {
        require_edit_key($inv);
        db()->prepare('UPDATE wishes SET hidden = 1 WHERE id = ? AND invite_id = ?')
            ->execute([(int)$mw[1], $id]);
        json_out(200, ['ok' => true]);
    }

    if (preg_match('#^/wishes/(\d+)$#', $sub, $mw) && $method === 'PATCH') {
        require_edit_key($inv);
        db()->prepare('UPDATE wishes SET hidden = 0 WHERE id = ? AND invite_id = ?')
            ->execute([(int)$mw[1], $id]);
        json_out(200, ['ok' => true]);
    }

    /* GET /invites/{id}/dashboard?k= */
    if ($sub === '/dashboard' && $method === 'GET') {
        if (!invite_auth($inv, s('k'))) json_out(403, ['error' => 'forbidden']);
        $st = db()->prepare('SELECT name, attending, guests, note, side, created_at FROM rsvps WHERE invite_id = ? ORDER BY id DESC');
        $st->execute([$id]);
        $rsvps = $st->fetchAll();
        $yes = array_values(array_filter($rsvps, fn($r) => (int)$r['attending'] === 1));
        $no  = array_values(array_filter($rsvps, fn($r) => (int)$r['attending'] === 0));
        $guests = array_sum(array_map(fn($r) => (int)$r['guests'], $yes));

        $st2 = db()->prepare('SELECT id, name, message, hidden, created_at FROM wishes WHERE invite_id = ? ORDER BY id DESC');
        $st2->execute([$id]);
        $wishes = array_map(fn($w) => [
            'id' => (string)$w['id'], 'name' => $w['name'], 'message' => $w['message'],
            'hidden' => (bool)$w['hidden'], 'createdAt' => $w['created_at'],
        ], $st2->fetchAll());

        json_out(200, [
            'referenceNumber' => (int)$inv['reference_number'], 'status' => $inv['status'], 'template' => $inv['template'],
            'data' => $inv['data'], 'addon' => (bool)$inv['addon'],
            'stats' => [
                'responses' => count($rsvps), 'coming' => count($yes),
                'declined' => count($no), 'guests' => $guests,
            ],
            'rsvps' => array_map(fn($r) => [
                'name' => $r['name'], 'attending' => (bool)$r['attending'],
                'guests' => (int)$r['guests'], 'note' => $r['note'],
                'createdAt' => $r['created_at'],
            ], $rsvps),
            'wishes' => $wishes,
        ]);
    }

    /* GET /invites/{id}/guests.csv?k= */
    if ($sub === '/guests.csv' && $method === 'GET') {
        if (!invite_auth($inv, s('k'))) json_out(403, ['error' => 'forbidden']);
        $st = db()->prepare('SELECT name, attending, guests, note, created_at FROM rsvps WHERE invite_id = ? ORDER BY id ASC');
        $st->execute([$id]);
        $out = "\u{FEFF}" . '"الاسم","الحضور","المرافقون","ملاحظة","الوقت"' . "\r\n";
        $csvCell = static function ($value): string {
            $text = (string)$value;
            if (preg_match('/^[\s\x00-\x1f]*[=+\-@]/u', $text) || preg_match('/^[\t\r\n]/', $text)) $text = "'" . $text;
            return '"' . str_replace('"', '""', $text) . '"';
        };
        foreach ($st->fetchAll() as $r) {
            $out .= implode(',', array_map($csvCell, [
                $r['name'], (int)$r['attending'] ? 'حاضر' : 'معتذر',
                (string)(int)$r['guests'], $r['note'] ?? '', $r['created_at'],
            ])) . "\r\n";
        }
        json_out(200, ['csv' => $out]);
    }
}

/* ============================ /checkout ============================ */
if ($path === '/checkout' && $method === 'POST') {
    $b = body_json();
    $inv = invite_get((string)($b['id'] ?? ''));
    if (!$inv || !invite_auth($inv, $b['k'] ?? null)) json_out(403, ['error' => 'forbidden']);

    $upgrading = $inv['status'] === 'active' && !empty($b['addonUpgrade']);
    if ($inv['status'] === 'active' && !$upgrading) json_out(200, ['alreadyActive' => true]);

    $pr = price_info();
    $base = $upgrading ? $pr['addon'] : $pr['amount'];

    if ($CFG['stripe_key'] === '') {
        if (!$CFG['allow_demo_checkout']) json_out(503, ['error' => 'الدفع بالبطاقة غير متاح حاليًا، اختر التحويل المحلي']);
        // وضع تجريبي صريح
        if ($upgrading) db()->prepare('UPDATE invites SET addon = 1 WHERE id = ?')->execute([$inv['id']]);
        activate_invite($inv);
        json_out(200, [
            'demo' => true,
            'url'  => $CFG['public_url'] . '/done?id=' . $inv['id'] . '&k=' . urlencode((string)$b['k']) . '&demo=1',
        ]);
    }

    if ($CFG['stripe_webhook_secret'] === '') json_out(503, ['error' => 'إعدادات تأكيد الدفع غير مكتملة، تواصل مع الإدارة']);
    try {
        $sess = stripe_post('checkout/sessions', [
            'mode' => 'payment',
            'success_url' => $CFG['public_url'] . '/done?id=' . $inv['id'] . '&k=' . urlencode((string)$b['k']) . '&session_id={CHECKOUT_SESSION_ID}',
            'cancel_url'  => $CFG['public_url'] . '/create?id=' . $inv['id'] . '&k=' . urlencode((string)$b['k']) . '&canceled=1',
            'client_reference_id' => $inv['id'],
            'metadata[invite_id]' => $inv['id'],
            'metadata[upgrading]' => $upgrading ? '1' : '0',
            'line_items[0][quantity]' => 1,
            'line_items[0][price_data][currency]' => $pr['currency'],
            'line_items[0][price_data][unit_amount]' => $base,
            'line_items[0][price_data][product_data][name]' => $upgrading
                ? 'إضافة دعوات الرجال والنساء — زَفّة'
                : 'دعوة زفاف إلكترونية — زَفّة',
        ] + ($inv['email'] ? ['customer_email' => $inv['email']] : []));
        db()->prepare('UPDATE invites SET stripe_session_id = ? WHERE id = ?')
            ->execute([$sess['id'], $inv['id']]);
        json_out(200, ['url' => $sess['url'], 'id' => $sess['id']]);
    } catch (Throwable $e) {
        json_out(502, ['error' => 'تعذّر بدء الدفع، حاول مرة ثانية']);
    }
}

/* ============================ /verify ============================ */
if ($path === '/verify' && $method === 'GET') {
    $inv = invite_get(s('id'));
    if (!$inv) json_out(404, ['error' => 'not found']);
    require_edit_key($inv);
    if ($inv['status'] === 'active') json_out(200, ['status' => 'active']);
    if ($CFG['stripe_key'] === '') json_out(200, ['status' => $inv['status']]);
    $sid = s('session_id');
    if ($sid === '') json_out(400, ['error' => 'session_id مطلوب']);
    if ($sid !== ($inv['stripe_session_id'] ?? '')) json_out(403, ['error' => 'جلسة الدفع لا تطابق الدعوة']);
    $sess = stripe_get('checkout/sessions/' . rawurlencode($sid));
    if (($sess['id'] ?? '') === $sid && ($sess['client_reference_id'] ?? '') === $inv['id'] && ($sess['payment_status'] ?? '') === 'paid') {
        if (($sess['metadata']['upgrading'] ?? '0') === '1') {
            db()->prepare('UPDATE invites SET addon = 1 WHERE id = ?')->execute([$inv['id']]);
        }
        activate_invite($inv);
        json_out(200, ['status' => 'active']);
    }
    json_out(200, ['status' => $inv['status'], 'payment_status' => $sess['payment_status'] ?? null]);
}

/* ============================ /stripe/webhook ============================ */
if ($path === '/stripe/webhook' && $method === 'POST') {
    $raw = (string)file_get_contents('php://input');
    $sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    if ($CFG['stripe_webhook_secret'] === '') json_out(503, ['error' => 'webhook not configured']);
    $timestamp = null; $signatures = [];
    foreach (explode(',', $sigHeader) as $kv) {
        $parts = explode('=', trim($kv), 2);
        if (count($parts) !== 2) continue;
        if ($parts[0] === 't') $timestamp = $parts[1];
        if ($parts[0] === 'v1') $signatures[] = $parts[1];
    }
    $valid = false;
    if ($timestamp !== null && ctype_digit($timestamp) && abs(time() - (int)$timestamp) <= 300) {
        $expected = hash_hmac('sha256', $timestamp . '.' . $raw, $CFG['stripe_webhook_secret']);
        foreach ($signatures as $signature) if (hash_equals($expected, $signature)) $valid = true;
    }
    if (!$valid) json_out(400, ['error' => 'bad signature']);
    $evt = json_decode($raw, true) ?: [];
    $type = $evt['type'] ?? '';
    if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
        $o = $evt['data']['object'] ?? [];
        $iid = $o['client_reference_id'] ?? ($o['metadata']['invite_id'] ?? '');
        $inv = $iid ? invite_get((string)$iid) : null;
        if ($inv && ($o['id'] ?? '') === ($inv['stripe_session_id'] ?? '') && ($o['payment_status'] ?? '') === 'paid') {
            if (($o['metadata']['upgrading'] ?? '0') === '1') {
                db()->prepare('UPDATE invites SET addon = 1 WHERE id = ?')->execute([$inv['id']]);
            }
            activate_invite($inv);
        }
    }
    json_out(200, ['received' => true]);
}

/* ============================ /bankak ============================ */
if ($path === '/bankak' && $method === 'POST') {
    if (!rate_limit('bankak', 10)) json_out(429, ['error' => 'محاولات كثيرة']);
    $b = body_json();
    $inv = invite_get((string)($b['id'] ?? ''));
    if (!$inv || !invite_auth($inv, $b['k'] ?? null)) json_out(403, ['error' => 'forbidden']);
    if ($inv['status'] === 'active') json_out(200, ['alreadyActive' => true]);

    $methods = ['bankak' => ['بنكك', $CFG['sd']['account']], 'fawry' => ['فوري', $CFG['sd']['fawry']], 'ocash' => ['أوكاش', $CFG['sd']['ocash']]];
    $method = (string)($b['method'] ?? 'bankak');
    if (!isset($methods[$method]) || $methods[$method][1] === '') json_out(400, ['error' => 'طريقة التحويل غير متاحة']);
    $txn = mb_substr(trim((string)($b['txn'] ?? '')), 0, 60);
    $sender = mb_substr(trim((string)($b['sender'] ?? '')), 0, 60);
    if ($txn === '' || $sender === '') json_out(400, ['error' => 'رقم العملية واسم المحوِّل مطلوبان']);

    db()->prepare("UPDATE invites SET status = 'pending', bank_txn = ?, bank_sender = ?, bank_method = ? WHERE id = ?")
        ->execute([$txn, $sender, $method, $inv['id']]);

    $msg = rawurlencode("طلب تفعيل دعوة\nطريقة التحويل: {$methods[$method][0]}\nالاسم: {$sender}\nرقم العملية: {$txn}\nالرقم المرجعي: {$inv['reference_number']}\nمعرّف الدعوة: {$inv['id']}");
    json_out(200, [
        'ok' => true,
        'wa' => 'https://wa.me/' . $CFG['sd']['whatsapp'] . '?text=' . $msg,
    ]);
}

/* ============================ /admin ============================ */
if ($path === '/admin') {
    require_admin($method !== 'GET');
    if ($method === 'GET') {
        $rows = db()->query(
            'SELECT i.*, (SELECT COUNT(*) FROM rsvps r WHERE r.invite_id = i.id) AS rsvp_count
             FROM invites i ORDER BY i.created_at DESC'
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $d = json_decode((string)$r['data'], true) ?: [];
            $out[] = [
                'id' => $r['id'], 'referenceNumber' => (int)$r['reference_number'], 'status' => $r['status'], 'template' => $r['template'],
                'email' => $r['email'], 'groom' => $d['groom'] ?? '', 'bride' => $d['bride'] ?? '',
                'date' => $d['date'] ?? '', 'createdAt' => $r['created_at'], 'paidAt' => $r['paid_at'],
                'bankTxn' => $r['bank_txn'], 'bankSender' => $r['bank_sender'], 'bankMethod' => $r['bank_method'] ?: 'bankak',
                'rsvps' => (int)$r['rsvp_count'],
            ];
        }
        json_out(200, [
            'invites' => $out,
            'sold' => sold_count(),
            'demoMode' => $CFG['stripe_key'] === '',
        ]);
    }
    if ($method === 'POST') {
        $b = body_json();
        $inv = invite_get((string)($b['id'] ?? ''));
        if (!$inv) json_out(404, ['error' => 'not found']);
        $action = $b['action'] ?? '';
        if ($action === 'activate') {
            activate_invite($inv);
        } elseif ($action === 'deactivate') {
            db()->prepare("UPDATE invites SET status = 'draft' WHERE id = ?")->execute([$inv['id']]);
        }
        json_out(200, ['ok' => true]);
    }
}

json_out(404, ['error' => 'not found']);
