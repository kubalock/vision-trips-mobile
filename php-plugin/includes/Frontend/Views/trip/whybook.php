<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Brand $brand */
if (!$brand->reasons && $brand->about === '') {
    return;
}
?>
<section class="vt-section" id="why" aria-labelledby="why-h">
  <h2 class="vt-h2" id="why-h">Why book with <?= e($brand->name) ?></h2>
  <?php if ($brand->reasons): ?>
    <ul class="vt-reasons" role="list">
      <?php foreach ($brand->reasons as $i => $r): ?>
        <li><span class="vt-reasons__n"><?= icon(['heart', 'shield', 'compass', 'sparkle'][$i % 4]) ?></span><div><strong><?= e($r['title']) ?></strong><?php if ($r['text'] !== ''): ?><div class="vt-longtext"><?= raw($r['text']) ?></div><?php endif; ?></div></li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
  <?php if ($brand->about !== '' && $trip->personalMessage !== ''): ?><div class="vt-longtext vt-why__about"><?= raw($brand->about) ?></div><?php endif; ?>
  <?php $review = $brand->googleReviews !== '' ? $brand->googleReviews : $brand->trustpilot; if ($review !== ''): ?><p class="vt-small"><a class="vt-link" href="<?= e($review) ?>" target="_blank" rel="noopener">See what our customers say</a></p><?php endif; ?>
</section>
