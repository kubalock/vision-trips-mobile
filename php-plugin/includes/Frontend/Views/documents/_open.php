<?php
/**
 * Document shell opener. Expects: $docTitle, $trip, $brand, $accent, $fontsUrl, $displayFont, $bodyFont, $back, $preview?
 */
namespace VisionTrips\Frontend;

$logo = $brand->logo !== '' ? $brand->logo : $brand->logoTransparent;
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<?= partial('partials/head', ['title' => $docTitle . ' — ' . $trip->ref . ' — ' . $brand->name, 'brand' => $brand, 'accent' => $accent, 'fontsUrl' => $fontsUrl, 'displayFont' => $displayFont, 'bodyFont' => $bodyFont, 'theme' => $trip->theme, 'preview' => $preview ?? false, 'stylesheet' => 'documents']) ?>
</head>
<body class="vt-doc">
<div class="vt-doc__bar">
  <a class="vt-doc__back" href="<?= e($back) ?>">Back to your trip</a>
  <span class="vt-doc__barttl"><?= e($docTitle) ?></span>
  <button type="button" class="vt-doc__print" onclick="window.print()"><?= icon('print') ?> Print / save PDF</button>
</div>
<button type="button" class="vt-doc__fab" onclick="window.print()" aria-label="Print or save as PDF"><?= icon('print') ?> Print</button>
<article class="vt-page">
  <header class="vt-letterhead">
    <div class="vt-letterhead__brand">
      <?php if ($logo !== ''): ?><img src="<?= e($logo) ?>" alt="<?= e($brand->name) ?>"><?php else: ?><strong class="vt-letterhead__name"><?= e($brand->name) ?></strong><?php endif; ?>
      <?php if ($brand->slogan !== ''): ?><p class="vt-letterhead__slogan"><?= e($brand->slogan) ?></p><?php endif; ?>
    </div>
    <div class="vt-letterhead__contact">
      <?php if ($propositionLogo !== ''): ?><img class="vt-letterhead__prop" src="<?= e($propositionLogo) ?>" alt="<?= e($brand->propositionLabel()) ?>"><?php endif; ?>
      <strong><?= e($brand->name) ?></strong>
      <?php if ($brand->addressLines): ?><span><?= e(implode(', ', $brand->addressLines)) ?></span><?php endif; ?>
      <?php if ($brand->phone !== ''): ?><span><?= e($brand->phone) ?></span><?php endif; ?>
      <?php if ($brand->email !== ''): ?><span><?= e($brand->email) ?></span><?php endif; ?>
      <?php if ($brand->webDomain !== ''): ?><span><?= e($brand->webDomain) ?></span><?php endif; ?>
    </div>
  </header>
