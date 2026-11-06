<?php
namespace VisionTrips\Frontend;

use VisionTrips\Integrations\Flights;

/**
 * Live flight board. Every flight the airport systems know about is shown, at whatever phase it is in, with every
 * detail available: check-in, gate call, boarding, in the air with an estimated arrival, landed with the bag belt.
 * A flight the systems have no record of yet is not on the board (the itinerary carries its times).
 * @var array<int,array{element:\VisionTrips\Domain\Element,status:?array}> $rows
 */
$known = array_values(array_filter($rows, static fn ($r) => is_array($r['status'])));
if (!$known) {
    return;
}
$bits = static function (array $parts): string { $p = array_values(array_filter($parts, static fn ($x) => $x !== '' && $x !== null)); return $p ? ' · ' . implode(' · ', $p) : ''; };
?>
<div class="vt-board" aria-label="Live flight status">
<?php foreach ($known as $row): $e = $row['element']; $s = $row['status']; $state = (string) ($s['status'] ?? 'unknown');
    $depChanged = $s['depActual'] !== '' && $s['depScheduled'] !== '' && $s['depActual'] !== $s['depScheduled'];
    $arrChanged = $s['arrActual'] !== '' && $s['arrScheduled'] !== '' && $s['arrActual'] !== $s['arrScheduled'];
    $depTime = $s['depActual'] !== '' ? $s['depActual'] : ($s['depScheduled'] !== '' ? $s['depScheduled'] : $e->startTime);
    $arrTime = $s['arrActual'] !== '' ? $s['arrActual'] : ($s['arrScheduled'] !== '' ? $s['arrScheduled'] : $e->endTime);
    $depLabel = match ($state) { 'departed', 'en_route', 'approaching', 'arrived' => 'Departed', default => 'Departs' };
    $arrLabel = match ($state) { 'arrived' => 'Landed', 'en_route', 'approaching', 'departed' => 'Estimated arrival', default => 'Arrives' };
    $callout = match ($state) {
        'go_to_gate'  => $s['depGate'] !== '' ? 'Please go to gate ' . $s['depGate'] : 'Please go to your gate',
        'boarding'    => $s['depGate'] !== '' ? 'Boarding now at gate ' . $s['depGate'] : 'Boarding now',
        'gate_closed' => 'Gate closed',
        'checkin'     => $s['depTerminal'] !== '' ? 'Check-in is open at Terminal ' . $s['depTerminal'] : 'Check-in is open',
        'arrived'     => $s['baggage'] !== '' ? 'Bags on belt ' . $s['baggage'] : '',
        'delayed'     => $s['depActual'] !== '' ? 'New departure time ' . $s['depActual'] : '',
        default       => '',
    };
?>
  <div class="vt-board__row is-<?= e($state) ?>">
    <div class="vt-board__flight">
      <span class="vt-board__no"><?= e($e->flightNo) ?></span>
      <span class="vt-board__route"><?= e($e->fromCode ?: $e->from) ?> <?= icon('arrow') ?> <?= e($e->toCode ?: $e->to) ?></span>
      <span class="vt-board__date"><?= e($e->start->format('D j M')) ?><?= $e->carrier !== '' ? ' · ' . e($e->carrier) : '' ?><?= $s['aircraft'] !== '' ? ' · ' . e($s['aircraft']) : '' ?></span>
    </div>
    <div class="vt-board__status">
      <strong><?= e(Flights::statusCopy($state, (int) $s['delayMinutes'])) ?></strong>
      <?php if ($callout !== ''): ?><span class="vt-board__callout"><?= e($callout) ?></span><?php endif; ?>
      <span><?= e($depLabel) ?> <?= e($depTime) ?><?php if ($depChanged): ?> <s><?= e($s['depScheduled']) ?></s><?php endif; ?><?= e($bits(['', $s['depTerminal'] !== '' ? 'Terminal ' . $s['depTerminal'] : '', $s['depGate'] !== '' && $state !== 'go_to_gate' && $state !== 'boarding' ? 'Gate ' . $s['depGate'] : ''])) ?></span>
      <span><?= e($arrLabel) ?> <?= e($arrTime) ?><?php if ($arrChanged): ?> <s><?= e($s['arrScheduled']) ?></s><?php endif; ?><?= e($bits(['', $s['arrTerminal'] !== '' ? 'Terminal ' . $s['arrTerminal'] : '', $s['arrGate'] !== '' ? 'Gate ' . $s['arrGate'] : '', $s['baggage'] !== '' && $state !== 'arrived' ? 'Belt ' . $s['baggage'] : ''])) ?></span>
    </div>
  </div>
<?php endforeach; ?>
  <p class="vt-board__note"><span>Live data from the airport systems; always follow the airline's own information. Updated <?= e(gmdate('H:i')) ?> UTC.</span><button type="button" class="vt-board__refresh" data-flight-refresh><?= icon('refresh') ?> Refresh</button></p>
</div>
