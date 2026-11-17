<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/**
 * The customer's other quotations: a pair when there is one, cards for two or three, a comparison table for more.
 * @var \VisionTrips\Domain\Trip $trip
 */
$others = $siblings ?? [];
if (!$others) {
    return;
}
$n = count($others);
$pp = static fn (float $total, float $pp) => $pp > 0 ? $pp : (count($trip->travellers) > 1 && $total > 0 ? round($total / count($trip->travellers), 2) : 0.0);
$thisNights = $trip->duration ?: 0;
$thisPp = $trip->perPerson();
$lead = $n === 1
    ? 'You have one other quotation open with us — here they are side by side.'
    : 'You have ' . $n . ' other quotations open with us. Compare them here, pick the one that feels right, or ask us to blend them.';
?>
<section class="vt-section" id="compare" aria-labelledby="compare-h">
  <h2 class="vt-h2" id="compare-h">Your options</h2>
  <p class="vt-section__lead"><?= e($lead) ?></p>
  <?php if ($n <= 3): ?>
  <div class="vt-compare vt-compare--<?= $n === 1 ? 'pair' : 'cards' ?>" role="list">
    <article class="vt-compare__card is-current" role="listitem">
      <span class="vt-compare__tag">This one</span>
      <strong><?= e($trip->name) ?></strong>
      <span><?= e($trip->dateRange()) ?><?= $thisNights ? ' · ' . e((string) $thisNights) . ' nights' : '' ?></span>
      <span class="vt-compare__price"><?= e($trip->money($trip->total)) ?><?= $thisPp > 0 ? ' <small>' . e($trip->money($thisPp)) . ' pp</small>' : '' ?></span>
    </article>
    <?php foreach ($others as $o): $opp = $pp((float) $o['total'], (float) ($o['pp'] ?? 0)); ?>
      <a class="vt-compare__card" role="listitem" href="<?= e($o['url']) ?>">
        <span class="vt-compare__tag">Option</span>
        <strong><?= e($o['name']) ?></strong>
        <span><?= e(Dates::range(Dates::parse($o['departs']), Dates::parse($o['returns']))) ?><?= !empty($o['nights']) ? ' · ' . e((string) $o['nights']) . ' nights' : '' ?></span>
        <?php if (!empty($o['total'])): ?><span class="vt-compare__price"><?= e($trip->money((float) $o['total'])) ?><?= $opp > 0 ? ' <small>' . e($trip->money($opp)) . ' pp</small>' : '' ?></span><?php endif; ?>
        <span class="vt-link">View this option</span>
      </a>
    <?php endforeach; ?>
  </div>
  <?php else: ?>
  <div class="vt-compare-table__wrap">
    <table class="vt-compare-table">
      <thead><tr><th scope="col">Quotation</th><th scope="col">Dates</th><th scope="col">Nights</th><th scope="col">Total</th><th scope="col">Per person</th><th scope="col"></th></tr></thead>
      <tbody>
        <tr class="is-current"><td data-label="Quotation"><strong><?= e($trip->name) ?></strong> <span class="vt-compare__tag">This one</span></td><td data-label="Dates"><?= e($trip->dateRange()) ?></td><td data-label="Nights"><?= $thisNights ? e((string) $thisNights) : '—' ?></td><td data-label="Total" class="num"><?= e($trip->money($trip->total)) ?></td><td data-label="Per person" class="num"><?= $thisPp > 0 ? e($trip->money($thisPp)) : '—' ?></td><td></td></tr>
        <?php foreach ($others as $o): $opp = $pp((float) $o['total'], (float) ($o['pp'] ?? 0)); ?>
          <tr><td data-label="Quotation"><strong><?= e($o['name']) ?></strong></td><td data-label="Dates"><?= e(Dates::range(Dates::parse($o['departs']), Dates::parse($o['returns']))) ?></td><td data-label="Nights"><?= !empty($o['nights']) ? e((string) $o['nights']) : '—' ?></td><td data-label="Total" class="num"><?= !empty($o['total']) ? e($trip->money((float) $o['total'])) : '—' ?></td><td data-label="Per person" class="num"><?= $opp > 0 ? e($trip->money($opp)) : '—' ?></td><td><a class="vt-btn vt-btn--ghost vt-btn--sm" href="<?= e($o['url']) ?>">View</a></td></tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?php endif; ?>
  <p class="vt-small"><a class="vt-link" href="#ask-top" data-ask data-ask-prefill="I'd like to talk through the different quotation options you've sent.">Help me choose</a></p>
</section>
