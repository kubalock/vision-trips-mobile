<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = $trip->isQuote() ? 'Quotation' : 'Booking confirmation';
echo partial('documents/_open', get_defined_vars());
$days = $trip->days();
$payments = $trip->sortedPayments();
$sections = [];
foreach (['correct_names' => 'Correct names notice', 'total_price' => 'Total price information', 'financial' => 'Financial protection', 'terms' => 'Terms & conditions', 'ptr' => 'Package travel regulations', 'flight' => 'Flight information', 'insurance' => 'Travel insurance', 'travel_aware' => 'Travel aware', 'important' => 'Important information'] as $k => $label) {
    if (!empty($brand->templates[$k])) {
        $sections[$label] = $brand->templates[$k];
    }
}
?>
  <h1 class="vt-page__title"><?= e($trip->name) ?></h1>
  <p class="vt-page__sub"><?= e($trip->dateRange()) ?><?= $trip->duration ? ' · ' . e($trip->duration) . ' nights' : '' ?></p>
  <dl class="vt-meta">
    <div><dt>Issued</dt><dd><?= e($issuedOn) ?></dd></div>
    <div><dt>Reference</dt><dd><?= e($trip->ref) ?></dd></div>
    <div><dt>Status</dt><dd class="vt-meta__status is-<?= e(strtolower(str_replace(' ', '-', $trip->status))) ?>"><?= e($trip->status) ?></dd></div>
    <?php if ($trip->lead): ?><div><dt>Lead passenger</dt><dd><?= e($trip->lead->name) ?></dd></div><?php endif; ?>
    <?php if ($trip->travellers): ?><div class="vt-meta__wide"><dt>Travellers</dt><dd><?= e(implode(', ', array_map(static fn ($t) => $t->name . ($showDob && $verified && $t->dob ? ' (' . $t->dob->format('d/m/Y') . ')' : ''), $trip->travellers))) ?></dd></div><?php endif; ?>
  </dl>

  <?php if ($trip->personalMessage !== ''): ?><div class="vt-doc__message"><?= raw($trip->personalMessage) ?></div><?php endif; ?>

  <?php if ($days): ?>
  <h2 class="vt-page__h2">Itinerary</h2>
  <?php foreach ($days as $d): ?>
    <h3 class="vt-page__day"><?= e($d['label']) ?><?= $d['day'] ? ' <span>Day ' . e($d['day']) . '</span>' : '' ?></h3>
    <?php foreach ($d['items'] as $e): ?>
      <div class="vt-doc__el">
        <div class="vt-doc__el-head"><strong><?= e($e->kind === 'flight' ? $e->from . ' to ' . $e->to : $e->title) ?></strong><span><?= e(View::kindLabel($e->kind)) ?><?= $e->onRequest ? ' (on request)' : '' ?></span></div>
        <dl class="vt-doc__kv">
          <?php if ($e->kind === 'flight'): ?>
            <?php if ($e->carrier !== '' || $e->flightNo !== ''): ?><div><dt>Flight</dt><dd><?= e(trim($e->carrier . ' ' . $e->flightNo)) ?></dd></div><?php endif; ?>
            <div><dt>Departs</dt><dd><?= e(Dates::long($e->start)) ?><?= $e->startTime !== '' ? ' at ' . e($e->startTime) : '' ?><?= $e->fromCode !== '' ? ' (' . e($e->fromCode) . ')' : '' ?></dd></div>
            <div><dt>Arrives</dt><dd><?= e($e->end ? Dates::long($e->end) : Dates::long($e->start)) ?><?= $e->endTime !== '' ? ' at ' . e($e->endTime) : '' ?><?= $e->toCode !== '' ? ' (' . e($e->toCode) . ')' : '' ?></dd></div>
            <?php if ($e->flightClass !== ''): ?><div><dt>Class</dt><dd><?= e($e->flightClass) ?></dd></div><?php endif; ?>
          <?php else: ?>
            <div><dt>Dates</dt><dd><?= e($e->kind === 'stay' || $e->kind === 'cruise' || $e->kind === 'carhire' || $e->kind === 'parking' ? Dates::range($e->start, $e->end) : Dates::long($e->start)) ?><?= $e->timeLabel() !== '' ? ', ' . e($e->timeLabel()) : '' ?><?= $e->nights ? ' (' . e($e->nights) . ' nights)' : '' ?></dd></div>
            <?php if ($e->from !== '' && $e->kind !== 'stay'): ?><div><dt>From</dt><dd><?= e($e->from) ?></dd></div><?php endif; ?>
            <?php if ($e->to !== '' && $e->kind !== 'stay'): ?><div><dt>To</dt><dd><?= e($e->to) ?></dd></div><?php endif; ?>
          <?php endif; ?>
          <?php if ($e->address !== ''): ?><div><dt>Address</dt><dd><?= e($e->address) ?></dd></div><?php endif; ?>
          <?php if ($e->rooms): ?><div><dt>Room</dt><dd><?= e(implode('; ', $e->rooms)) ?></dd></div><?php endif; ?>
          <?php if ($e->ship !== ''): ?><div><dt>Ship</dt><dd><?= e(trim(($e->cruiseLine !== '' ? $e->cruiseLine . ', ' : '') . $e->ship)) ?></dd></div><?php endif; ?>
          <?php foreach ($e->cabins as $cabin): ?><div><dt>Cabin</dt><dd><?= e(implode(' · ', array_map(static fn ($k, $v) => $k . ' ' . $v, array_keys($cabin), $cabin))) ?></dd></div><?php endforeach; ?>
          <?php foreach (array_merge($e->car, $e->train) as $k => $v): ?><div><dt><?= e($k) ?></dt><dd><?= e($v) ?></dd></div><?php endforeach; ?>
          <?php if (!$e->supplierHidden && $e->supplier !== ''): ?><div><dt>Provided by</dt><dd><?= e($e->supplier) ?></dd></div><?php endif; ?>
          <?php if (!$e->supplierHidden && $e->supplierRef !== ''): ?><div><dt>Reference</dt><dd><?= e($e->supplierRef) ?></dd></div><?php endif; ?>
          <?php if ($e->passengers && !$trip->isQuote()): ?><div><dt>Travelling</dt><dd><?= e(implode('; ', array_map(static fn ($p) => $p['name'] . (isset($p['Seat']) ? ' (seat ' . $p['Seat'] . ')' : ''), $e->passengers))) ?></dd></div><?php endif; ?>
          <?php foreach ($e->details as $row): if ($row['long']) { continue; } ?><div><dt><?= e($row['label']) ?></dt><dd><?= raw($row['value']) ?></dd></div><?php endforeach; ?>
        </dl>
        <?php if ($e->ports): ?><p class="vt-doc__ports"><strong>Ports:</strong> <?= e(implode(' · ', array_map(static fn ($p) => 'Day ' . $p['day'] . ' ' . $p['port'], $e->ports))) ?></p><?php endif; ?>
        <?php foreach ([$e->pickupInstructions, $e->dropoffInstructions, $e->furtherInfo, $e->importantInfo] as $txt): if ($txt !== ''): ?><div class="vt-doc__long"><?= raw($txt) ?></div><?php endif; endforeach; ?>
        <?php foreach ($e->details as $row): if (!$row['long']) { continue; } ?><div class="vt-doc__long"><strong><?= e($row['label']) ?>:</strong> <?= raw($row['value']) ?></div><?php endforeach; ?>
      </div>
    <?php endforeach; ?>
  <?php endforeach; ?>
  <?php endif; ?>

  <h2 class="vt-page__h2">Price and payments</h2>
  <table class="vt-table">
    <tbody>
      <tr class="vt-table__total"><td>Total price payable to <?= e($brand->name) ?></td><td class="num"><?= e($trip->money($trip->total)) ?></td></tr>
      <?php if ($trip->totalInclResort > 0 && abs($trip->totalInclResort - $trip->total) > 0.01): ?><tr><td>Total cost including payments made locally</td><td class="num"><?= e($trip->money($trip->totalInclResort)) ?></td></tr><?php endif; ?>
      <?php if (!$trip->isQuote()): ?><tr><td>Paid to us</td><td class="num"><?= e($trip->money($trip->paid)) ?></td></tr><tr><td>Balance due to us<?= $trip->balanceDueDate ? ' by ' . e(Dates::medium($trip->balanceDueDate)) : '' ?></td><td class="num"><?= e($trip->money($trip->balance)) ?></td></tr><?php endif; ?>
    </tbody>
  </table>
  <?php if ($payments): ?>
  <table class="vt-table vt-table--rows">
    <thead><tr><th>Payment</th><th>Due</th><th>Status</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <?php foreach ($payments as $p): ?><tr><td><?= e($p->label()) ?><?= $p->isResort() && $p->resortReason !== '' ? ' — ' . e($p->resortReason) : '' ?></td><td><?= e($p->isResort() ? 'Locally' : Dates::numeric($p->due)) ?></td><td><?= e($p->isPaid() ? 'Received ' . Dates::numeric($p->completed) : $p->status) ?></td><td class="num"><?= e($p->money()) ?></td></tr><?php endforeach; ?>
    </tbody>
  </table>
  <?php endif; ?>
  <?php if ($brand->trustAccountNumber !== '' && $trip->balance > 0.009 && !$trip->isQuote()): ?>
    <p class="vt-doc__bank"><strong>Bank transfer:</strong> <?= e($brand->trustAccountName) ?><?= $brand->trustSortCode !== '' ? ', sort code ' . e($brand->trustSortCode) : '' ?>, account <?= e($brand->trustAccountNumber) ?>, reference <strong><?= e($trip->ref) ?></strong>.</p>
  <?php endif; ?>

  <?php $notice = \VisionTrips\Domain\Legal::notice($trip); ?>
  <h2 class="vt-page__h2">Key information</h2>
  <div class="vt-doc__keyinfo"><?= \VisionTrips\Domain\Legal::keyInformationHtml($trip) ?></div>
  <?php if ($notice): ?><div class="vt-doc__notice"><h3><?= e($notice['title']) ?></h3><?= raw($notice['html']) ?></div><?php endif; ?>
  <?php if ($trip->protection->atolApplies() || $sections): ?>
  <h2 class="vt-page__h2">Important information</h2>
  <div class="vt-doc__info">
    <article><h3>Who you are booking with</h3><?= partial('trip/protection-text', get_defined_vars()) ?></article>
    <?php foreach ($sections as $label => $html): ?><article><h3><?= e($label) ?></h3><?= raw($html) ?></article><?php endforeach; ?>
  </div>
  <?php endif; ?>
<?= partial('documents/_close', get_defined_vars()) ?>
