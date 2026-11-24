<?php
/* صورة المشاركة للدعوة المفعّلة؛ PNG عند توفرها وSVG بديلًا. */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$id = $_GET['id'] ?? '';
$inv = (is_string($id) && preg_match('/^[a-z0-9]{4,20}$/', $id)) ? invite_get($id) : null;
if (!$inv) { http_response_code(404); exit; }
if ($inv['status'] !== 'active') { http_response_code(403); header('Cache-Control: no-store'); exit; }

if (($_GET['format'] ?? 'svg') === 'png') {
    $file = $CFG['og_dir'] . '/' . $id . '.png';
    if (is_file($file)) {
        header('Content-Type: image/png'); header('Content-Length: ' . filesize($file));
        header('Cache-Control: public, max-age=600'); readfile($file); exit;
    }
}
header('Content-Type: image/svg+xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');
echo og_svg($inv);
