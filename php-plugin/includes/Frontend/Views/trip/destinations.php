<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$list = array_values(array_filter($trip->destinations, static fn ($d) => !empty($d['primary']) || $d['image'] !== '' || $d['overview'] !== ''));
if (!$list) {
    return;
}
?>
<section class="vt-section" id="destinations" aria-labelledby="dest-h">
  <h2 class="vt-h2" id="dest-h"><?= count($list) === 1 ? 'About ' . e($list[0]['name']) : 'Where you\'re going' ?></h2>
  <?php $vm = get_defined_vars(); ?>
  <?= View::external('destinations', $preview, fn () => \VisionTrips\Rest\Api::destinationsFragment($trip, $vm), 'card') ?>
</section>
