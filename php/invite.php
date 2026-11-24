<?php
/* عرض دعوة واحدة: /i/{id}  →  يُحقن window.INVITE في القالب */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$id = $_GET['id'] ?? '';
if (!is_string($id) || !preg_match('/^[a-z0-9]{4,20}$/', $id)) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>غير موجود</title>'
       . '<div style="font-family:sans-serif;text-align:center;padding:4rem 1rem">'
       . '<h1>الدعوة غير موجودة</h1><p>تحقق من الرابط الذي وصلك.</p></div>';
    exit;
}

// معاينة القوالب لا تعتمد على وجود دعوة مدفوعة في قاعدة البيانات.
if ($id === 'demo') {
    $themes = themes(); $template = (string)($_GET['t'] ?? 'garden');
    if (!isset($themes[$template])) $template = 'garden';
    header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-cache');
    echo render_invite(['id' => 'demo', 'template' => $template, 'data' => []]); exit;
}

$inv = invite_get($id);
if (!$inv) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>غير موجود</title>'
       . '<div style="font-family:sans-serif;text-align:center;padding:4rem 1rem">'
       . '<h1>الدعوة غير موجودة</h1><p>تحقق من الرابط الذي وصلك.</p></div>';
    exit;
}

if ($inv['status'] !== 'active') {
    http_response_code(403); header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store');
    echo '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>الدعوة غير مفعّلة</title><main style="text-align:center;padding:4rem 1rem;font-family:sans-serif"><h1>الدعوة غير مفعّلة بعد</h1><p>ستكون متاحة بعد تأكيد التفعيل.</p></main></html>'; exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo render_invite($inv);
