<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$todayItems = $trip->elementsOn($now);
$upcoming = $trip->upcoming($now, 2);
$flights = $trip->trackableFlights();
$ooh = $brand->emergencyPhone !== '' ? $brand->emergencyPhone : $trip->emergencyPhone;
?>
<section class="vt-section vt-today" id="today" aria-labelledby="today-h">
  <div class="vt-today__head">
    <h2 class="vt-h2" id="today-h"><?= e($now->format('l j F')) ?></h2>
    <?php $vm = get_defined_vars(); ?>
    <?php if ($weather): ?><div class="vt-today__weather"><?= View::external('weather', $preview, fn () => \VisionTrips\Rest\Api::weatherFragment($trip, $vm), 'chip', 'data-quiet="1"') ?></div><?php endif; ?>
  </div>

  <?php if ($flights && $flightsOn): ?>
    <?php $vm = get_defined_vars(); ?>
    <?= View::external('flights', $preview, fn () => \VisionTrips\Rest\Api::flightsFragment($trip, $vm), 'row', 'data-refresh="180" data-quiet="1"') ?>
  <?php endif; ?>

  <?php if ($todayItems): ?>
    <h3 class="vt-h3">Today</h3>
    <ul class="vt-now" role="list">
      <?php foreach ($todayItems as $e): ?>
        <li class="vt-now__item">
          <span class="vt-now__icon"><?= View::kindIcon($e->kind) ?></span>
          <div>
            <strong><?= e($e->shortTitle()) ?></strong>
            <span><?= e($e->kind === 'stay' ? ($e->end && $e->end->format('Y-m-d') === $now->format('Y-m-d') ? 'Check-out today' : 'Night ' . ((Dates::daysBetween($e->start, $now) ?? 0) + 1) . ' of ' . max(1, $e->nights)) : trim($e->timeLabel() . ' · ' . $e->subtitle(), ' ·')) ?></span>
            <?php if ($e->kind === 'stay' && $e->address !== ''): ?><a class="vt-link" href="<?= e(\VisionTrips\Integrations\Places::directionsUrl($e->title . ', ' . $e->address, $e->lat, $e->lng)) ?>" target="_blank" rel="noopener">Directions</a><?php endif; ?>
          </div>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>

  <?php if ($upcoming): ?>
    <h3 class="vt-h3">Coming up</h3>
    <ul class="vt-now vt-now--muted" role="list">
      <?php foreach ($upcoming as $e): ?>
        <li class="vt-now__item">
          <span class="vt-now__icon"><?= View::kindIcon($e->kind) ?></span>
          <div><strong><?= e($e->shortTitle()) ?></strong><span><?= e($e->start->format('D j M')) ?><?= $e->startTime !== '' ? ', ' . e($e->startTime) : '' ?><?= $e->subtitle() !== '' ? ' · ' . e($e->subtitle()) : '' ?></span></div>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>

  <?php if ($ooh !== '' || $brand->phone !== ''): ?>
    <div class="vt-today__help">
      <?= icon('phone') ?>
      <div>
        <strong>If you need us while you're away</strong>
        <span><?php if ($ooh !== ''): ?>Out of hours: <a href="<?= e(tel($ooh)) ?>"><?= e($ooh) ?></a><?php endif; ?><?php if ($brand->phone !== ''): ?><?= $ooh !== '' ? ' · ' : '' ?>Office: <a href="<?= e(tel($brand->phone)) ?>"><?= e($brand->phone) ?></a><?php endif; ?></span>
      </div>
    </div>
  <?php endif; ?>
</section>
