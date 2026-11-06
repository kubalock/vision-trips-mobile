<?php
namespace VisionTrips\Frontend;

/** @var array $forecast */
?>
<div class="vt-weather" title="<?= e($forecast['label']) ?>">
  <?= icon($forecast['icon']) ?>
  <div>
    <strong><?= e($forecast['temp']) ?>°</strong>
    <span><?= e($place) ?> · <?= e($forecast['label']) ?> · <?= e($forecast['low']) ?>–<?= e($forecast['high']) ?>°</span>
  </div>
</div>
