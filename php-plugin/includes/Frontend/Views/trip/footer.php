<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Brand $brand */
?>
<footer class="vt-footer">
  <div class="vt-wrap">
    <?php if ($brand->footerImages): ?><div class="vt-footer__images"><?php foreach ($brand->footerImages as $img): ?><img src="<?= e($img) ?>" alt="" loading="lazy" decoding="async"><?php endforeach; ?></div><?php endif; ?>
    <?php if ($brand->social): ?>
      <ul class="vt-footer__social" role="list"><?php foreach ($brand->social as $k => $url): ?><li><a href="<?= e($url) ?>" target="_blank" rel="noopener"><?= e(ucfirst($k === 'x' ? 'X' : $k)) ?></a></li><?php endforeach; ?></ul>
    <?php endif; ?>
    <?php if ($brand->footerContent !== ''): ?><div class="vt-footer__content"><?= raw($brand->footerContent) ?></div><?php endif; ?>
    <p class="vt-footer__legal"><?= e($brand->legalLine()) ?></p>
    <p class="vt-footer__links">
      <?php if ($brand->privacyUrl !== ''): ?><a href="<?= e($brand->privacyUrl) ?>" target="_blank" rel="noopener">Privacy</a><?php endif; ?>
      <?php if ($brand->complaintsUrl !== ''): ?><a href="<?= e($brand->complaintsUrl) ?>" target="_blank" rel="noopener">Complaints</a><?php endif; ?>
      <?php if ($brand->webDomain !== ''): ?><a href="<?= e($brand->webUrl()) ?>" target="_blank" rel="noopener"><?= e($brand->webDomain) ?></a><?php endif; ?>
      <?php if (!empty($urls['portal']) && empty($traveller)): ?><a href="<?= e($urls['portal']) ?>">All my trips</a><a href="<?= e($urls['portal']) ?>&view=prefs">Contact preferences</a><?php endif; ?>
      <a href="<?= e(home_url('/' . trim((string) \VisionTrips\Settings::get('trip_page_slug', 'trip'), '/') . '/accessibility/')) ?>">Accessibility</a>
      <?php if ($level > 0): ?><a href="<?= e($urls['self']) ?>?signout=1">Sign out of this device</a><?php endif; ?>
    </p>
    <?php if ($brand->memberDisclaimer !== ''): ?><div class="vt-footer__disclaimer"><?= raw($brand->memberDisclaimer) ?></div><?php endif; ?>
    <p class="vt-footer__vision"><?= e($legalText) ?></p>
  </div>
</footer>
