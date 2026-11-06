<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
if (!$trip->upsells) {
    return;
}
$title = $trip->isQuote() ? 'Make it yours' : (in_array($trip->stage, [\VisionTrips\Domain\Stage::HOME, \VisionTrips\Domain\Stage::PAST], true) ? 'For next time' : 'Enhance your trip');
?>
<section class="vt-section" id="extras" aria-labelledby="extras-h">
  <h2 class="vt-h2" id="extras-h"><?= e($title) ?></h2>
  <ul class="vt-extras" role="list">
    <?php foreach ($trip->upsells as $u): ?>
      <li class="vt-extra">
        <?php if ($u['image'] !== ''): ?><img src="<?= e($u['image']) ?>" alt="" loading="lazy" decoding="async"><?php endif; ?>
        <div>
          <strong><?= e($u['name']) ?></strong>
          <?php if ($u['info'] !== ''): ?><div class="vt-extra__text"><?= raw($u['info']) ?></div><?php endif; ?>
          <a class="vt-link" href="#help" data-ask data-ask-prefill="I'd like to add <?= e($u['name']) ?> to my booking.">Ask us to add this</a>
        </div>
      </li>
    <?php endforeach; ?>
  </ul>
</section>
