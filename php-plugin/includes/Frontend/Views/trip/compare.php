<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** Other open quotations for the same customer, side by side: choosing between options converts better than yes/no. */
/** @var \VisionTrips\Domain\Trip $trip */
$others = $siblings ?? [];
if (!$others) {
    return;
}
?>
<section class="vt-section" id="compare" aria-labelledby="compare-h">
  <h2 class="vt-h2" id="compare-h">Your options</h2>
  <p class="vt-section__lead">You have more than one quotation open with us. Here they are together — pick the one that feels right, or ask us to blend them.</p>
  <div class="vt-compare" role="list">
    <article class="vt-compare__card is-current" role="listitem">
      <span class="vt-compare__tag">This one</span>
      <strong><?= e($trip->name) ?></strong>
      <span><?= e($trip->dateRange()) ?><?= $trip->duration ? ' · ' . e((string) $trip->duration) . ' nights' : '' ?></span>
      <span class="vt-compare__price"><?= e($trip->money($trip->total)) ?></span>
    </article>
    <?php foreach ($others as $o): ?>
      <a class="vt-compare__card" role="listitem" href="<?= e($o['url']) ?>">
        <span class="vt-compare__tag">Option</span>
        <strong><?= e($o['name']) ?></strong>
        <span><?= e(Dates::range(Dates::parse($o['departs']), Dates::parse($o['returns']))) ?></span>
        <?php if (!empty($o['total'])): ?><span class="vt-compare__price"><?= e($trip->money((float) $o['total'])) ?></span><?php endif; ?>
        <span class="vt-link">View this option</span>
      </a>
    <?php endforeach; ?>
  </div>
  <p class="vt-small"><a class="vt-link" href="#help" data-ask data-ask-prefill="I'd like to talk through the different quotation options you've sent.">Help me choose</a></p>
</section>
