<?php
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;
use VisionTrips\Support\Dates;

/** Stage-aware "Up next" card: one action, the next milestone, and quick links — so the phone view answers the question before the scroll. */
/** @var \VisionTrips\Domain\Trip $trip */
$items = [];
$primary = null;
$next = $trip->nextPayment();
switch ($trip->stage) {
    case Stage::QUOTE:
        $primary = $quoteAccept ? ['label' => 'Accept and pay deposit', 'href' => '#accept', 'attr' => 'data-open-accept'] : ['label' => 'Ask a question', 'href' => '#help', 'attr' => 'data-ask'];
        $items[] = ['icon' => 'clock', 'text' => $trip->quoteExpiry ? 'Price held until ' . Dates::medium($trip->quoteExpiry) : 'Prices can change until you book'];
        $items[] = ['icon' => 'list', 'text' => count($trip->activeElements()) . ' items in your itinerary', 'href' => '#itinerary'];
        break;
    case Stage::CONFIRMED:
    case Stage::COUNTDOWN:
        if ($trip->balance > 0.009) {
            $primary = ['label' => 'Pay ' . $trip->money($trip->balance) . ($trip->balanceDueDate ? ' by ' . Dates::medium($trip->balanceDueDate) : ''), 'href' => '#payments'];
        }
        foreach ($trip->nextSteps() as $s) {
            if (!$s['done']) {
                $items[] = ['icon' => 'check', 'text' => $s['title'] . ($s['when'] !== '' ? ' · ' . $s['when'] : ''), 'href' => '#next'];
                break;
            }
        }
        $items[] = ['icon' => 'sparkle', 'text' => 'Add transfers, upgrades or experiences', 'href' => '#extras'];
        break;
    case Stage::PREP:
        $primary = ['label' => 'Before you go', 'href' => '#checklist'];
        $items[] = ['icon' => 'doc', 'text' => !empty($trip->tasks['documents']) ? 'Your travel documents are ready' : 'Travel documents on their way', 'href' => '#documents'];
        $items[] = ['icon' => 'phone', 'text' => 'Out-of-hours number saved in Help', 'href' => '#help'];
        break;
    case Stage::DEPARTURE:
    case Stage::TRAVELLING:
    case Stage::RETURNING:
        $primary = \VisionTrips\Settings::module('wallet') ? ['label' => 'Open your travel wallet', 'href' => $urls['docs'] . 'wallet/'] : ['label' => 'Tickets and documents', 'href' => '#documents'];
        $items[] = ['icon' => 'phone', 'text' => 'Need us? Out-of-hours line in Help', 'href' => '#help'];
        $items[] = ['icon' => 'clock', 'text' => 'Live flight status and today\'s plan', 'href' => '#today'];
        break;
    case Stage::HOME:
        $primary = ['label' => 'Tell us how it went', 'href' => '#home'];
        $items[] = ['icon' => 'compass', 'text' => 'Start planning the next one', 'href' => '#help'];
        break;
    default:
        return;
}
if (!$primary && !$items) {
    return;
}
?>
<section class="vt-summary" aria-label="Up next">
  <div class="vt-summary__head"><span class="vt-summary__kicker">Up next</span><?php if ($trip->agentName !== ''): ?><span class="vt-summary__agent"><?= icon('user') ?> <?= e($trip->agentName) ?> is looking after this trip</span><?php endif; ?></div>
  <?php if ($primary): ?><a class="vt-btn vt-btn--primary vt-btn--wide" href="<?= e($primary['href']) ?>" <?= $primary['attr'] ?? '' ?>><?= e($primary['label']) ?></a><?php endif; ?>
  <?php if ($items): ?>
    <ul class="vt-summary__list" role="list">
      <?php foreach ($items as $it): ?><li><?= icon($it['icon']) ?><?php if (!empty($it['href'])): ?><a href="<?= e($it['href']) ?>"><?= e($it['text']) ?></a><?php else: ?><span><?= e($it['text']) ?></span><?php endif; ?></li><?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
