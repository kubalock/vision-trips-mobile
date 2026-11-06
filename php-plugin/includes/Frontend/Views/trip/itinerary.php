<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$days = $trip->days();
$collapsed = in_array($trip->stage, [\VisionTrips\Domain\Stage::HOME, \VisionTrips\Domain\Stage::PAST], true);
?>
<section class="vt-section" id="itinerary" aria-labelledby="itinerary-h">
  <div class="vt-section__head">
    <h2 class="vt-h2" id="itinerary-h"><?= $trip->isQuote() ? 'What we\'ve put together' : 'Your itinerary' ?></h2>
    <?php if (!$trip->isQuote() && $days && !$surprise): ?><a class="vt-link" href="<?= e($urls['ics']) ?>"><?= icon('calendar') ?> Add to calendar</a><?php endif; ?>
  </div>
  <?php if (!$days): ?>
    <p class="vt-empty">Your itinerary will appear here as soon as it's confirmed.</p>
  <?php else: ?>
    <div class="vt-days<?= $collapsed ? ' is-collapsed' : '' ?>">
      <?php foreach ($days as $d): ?>
        <div class="vt-day">
          <div class="vt-day__head">
            <span class="vt-day__label"><?= e($d['label']) ?></span>
            <?php if ($d['day'] !== null && $d['day'] > 0): ?><span class="vt-day__n">Day <?= e($d['day']) ?></span><?php endif; ?>
          </div>
          <div class="vt-day__items">
            <?php foreach ($d['items'] as $e): ?>
              <?= partial('trip/element', get_defined_vars() + ['e' => $e]) ?>
            <?php endforeach; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
    <?php if ($collapsed): ?><button type="button" class="vt-btn vt-btn--ghost" data-expand-days>Show full itinerary</button><?php endif; ?>
  <?php endif; ?>
</section>
