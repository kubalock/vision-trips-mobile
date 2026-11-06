<?php
/**
 * Shared <head> for all plugin pages.
 * Expects: $title, $brand, $accent, $fontsUrl, $displayFont, $bodyFont, $theme (key), optional $preview, $stylesheet ('vision'|'documents')
 */
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Theme;

$stylesheet = $stylesheet ?? 'vision';
$preview = $preview ?? false;
$theme = $theme ?? 'default';
$faviconUrl = $brand->favicon !== '' ? $brand->favicon : ($brand->logo !== '' ? $brand->logo : '');
$assetBase = defined('VISION_TRIPS_URL') ? VISION_TRIPS_URL . 'assets/' : '';
$ver = class_exists('\\VisionTrips\\Plugin') ? \VisionTrips\Plugin::assetVersion('assets/css/' . $stylesheet . '.css') : '1';
$vars = Theme::cssVars($theme, $brand->fontDisplay);
$vars['--vt-accent'] = $accent;
$vars['--vt-accent-2'] = $brand->colour2 !== '' ? $brand->colour2 : $accent;
$vars['--vt-body'] = "'" . $bodyFont . "', 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
$vars['--accent-ink'] = View::contrastInk($accent);
$vars['--vt-accent-text'] = View::accessibleAccent($accent, '#F4F4F1');
$vars['--vt-accent-text-dark'] = View::accessibleAccent($accent, '#121415');
?>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="<?= e($accent) ?>">
<title><?= e($title) ?></title>
<?php if ($faviconUrl !== ''): ?><link rel="icon" href="<?= e($faviconUrl) ?>"><?php endif; ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="<?= e($fontsUrl) ?>">
<style id="vt-tokens">:root{<?php foreach ($vars as $k => $v): ?><?= e($k) ?>:<?= str_replace(['<', '>', ';'], '', $v) ?>;<?php endforeach; ?>}</style>
<?php if ($preview): ?>
<style><?= file_get_contents(VISION_TRIPS_DIR . 'assets/css/' . $stylesheet . '.css') ?></style>
<?php else: ?>
<link rel="stylesheet" href="<?= e($assetBase . 'css/' . $stylesheet . '.css?ver=' . $ver) ?>">
<?php endif; ?>
