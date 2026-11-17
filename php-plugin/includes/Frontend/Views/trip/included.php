<?php
namespace VisionTrips\Frontend;

/** What's included, with ticks, and what isn't — the question every quotation gets asked first. */
/** @var \VisionTrips\Domain\Trip $trip */
$inc = $trip->inclusions();
if (!$inc['included']) {
    return;
}
?>
<section class="vt-section" id="included" aria-labelledby="included-h">
  <h2 class="vt-h2" id="included-h">What's included</h2>
  <div class="vt-included">
    <ul class="vt-included__list" role="list">
      <?php foreach ($inc['included'] as $line): ?><li><?= icon('check') ?><span><?= e($line) ?></span></li><?php endforeach; ?>
    </ul>
    <?php if ($inc['excluded']): ?>
      <h3 class="vt-h4">Not included</h3>
      <ul class="vt-included__list is-excluded" role="list">
        <?php foreach ($inc['excluded'] as $line): ?><li><?= icon('close') ?><span><?= e($line) ?></span></li><?php endforeach; ?>
      </ul>
    <?php endif; ?>
  </div>
</section>
