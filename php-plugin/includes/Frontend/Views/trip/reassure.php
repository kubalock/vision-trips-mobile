<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$p = $trip->protection;
$items = [];
if ($p->atolApplies()) {
    $items[] = ['shield', 'ATOL protected', $p->holderNumber !== '' ? 'ATOL ' . $p->holderNumber : 'Flight-inclusive protection'];
} elseif (!$p->ticketAgent && $p->trustLabel !== '') {
    $items[] = ['shield', 'Money held in trust', ucfirst($p->trustLabel)];
} elseif (!$p->ticketAgent) {
    $items[] = ['shield', 'Financially protected', 'As set out in your booking conditions'];
}
$items[] = ['user', 'Your own travel expert', $trip->agentName !== '' ? $trip->agentName : $brand->name];
$items[] = ['heart', 'Built around you', 'Tailored, not off the shelf'];
if ($brand->emergencyPhone !== '' || $trip->emergencyPhone !== '') {
    $items[] = ['phone', 'With you while away', 'Out-of-hours support'];
}
?>
<ul class="vt-reassure" role="list" aria-label="Why you can relax">
  <?php foreach ($items as [$ic, $t, $sub]): ?><li><?= icon($ic) ?><span><strong><?= e($t) ?></strong><em><?= e($sub) ?></em></span></li><?php endforeach; ?>
</ul>
