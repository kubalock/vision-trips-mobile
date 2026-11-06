<?php
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;

/** @var \VisionTrips\Domain\Trip $trip */
$items = [['#top', 'home', 'Trip']];
if (!$surprise && !in_array($stage, [Stage::CLOSED, Stage::CANCELLED, Stage::QUOTE_EXPIRED], true)) {
    $items[] = ['#itinerary', 'list', 'Itinerary'];
}
if ($stage === Stage::QUOTE && $quoteAccept) {
    $items[] = ['#accept', 'check', 'Accept'];
}
if ($stage !== Stage::CLOSED && $stage !== Stage::QUOTE_EXPIRED) {
    $items[] = ['#payments', 'wallet', $trip->isQuote() ? 'Price' : 'Pay'];
}
if (!$trip->isQuote() && $stage !== Stage::CLOSED) {
    $items[] = ['#documents', 'doc', 'Docs'];
}
$items[] = ['#help', 'help', 'Help'];
?>
<nav class="vt-nav" aria-label="Sections">
  <?php foreach ($items as [$href, $ic, $label]): ?><a href="<?= e($href) ?>" data-nav="<?= e(ltrim($href, '#')) ?>"><?= icon($ic) ?><span><?= e($label) ?></span></a><?php endforeach; ?>
</nav>
