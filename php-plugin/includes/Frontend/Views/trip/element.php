<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Element $e */
/** @var \VisionTrips\Domain\Trip $trip */
$showSupplier = !$e->supplierHidden && $e->supplier !== '';
$protection = $trip->protection->forElement($e, $trip->anyExplicitPackage());
$meta = [];
switch ($e->kind) {
    case 'flight':
        $route = ($e->fromCode !== '' ? $e->fromCode : $e->from) . ' – ' . ($e->toCode !== '' ? $e->toCode : $e->to);
        $meta[] = trim(($e->carrier !== '' ? $e->carrier . ' ' : '') . $e->flightNo);
        if ($e->flightClass !== '') { $meta[] = $e->flightClass; }
        break;
    case 'stay':
        $meta[] = Dates::range($e->start, $e->end) . ($e->nights ? ', ' . $e->nights . ' night' . ($e->nights === 1 ? '' : 's') : '');
        if ($e->rooms) { $meta[] = implode('; ', $e->rooms); }
        break;
    case 'cruise':
        $meta[] = trim(($e->cruiseLine !== '' ? $e->cruiseLine . ' · ' : '') . $e->ship);
        $meta[] = Dates::range($e->start, $e->end) . ($e->nights ? ', ' . $e->nights . ' nights' : '');
        if ($e->departPort !== '') { $meta[] = 'From ' . $e->departPort; }
        break;
    case 'transfer':
    case 'train':
        if ($e->from !== '' || $e->to !== '') { $meta[] = ($e->from ?: '—') . ' to ' . ($e->to ?: '—'); }
        if ($e->train) { $meta[] = implode(', ', $e->train); }
        break;
    case 'carhire':
        $meta[] = Dates::range($e->start, $e->end);
        if ($e->from !== '') { $meta[] = 'Collect: ' . $e->from . ($e->startTime !== '' ? ' ' . $e->startTime : ''); }
        if ($e->to !== '') { $meta[] = 'Return: ' . $e->to . ($e->endTime !== '' ? ' ' . $e->endTime : ''); }
        break;
    case 'parking':
        $meta[] = Dates::range($e->start, $e->end);
        if (($e->car['Booking code'] ?? '') !== '') { $meta[] = 'Code ' . $e->car['Booking code']; }
        break;
    default:
        if ($e->from !== '') { $meta[] = $e->from; }
}
$displayTitle = $e->shortTitle();
$showTime = $e->startTime !== '' && in_array($e->kind, ['flight', 'train', 'transfer', 'attraction', 'misc'], true);
$meta = array_values(array_filter($meta));
$hasDetails = $showSupplier || $e->supplierRef !== '' || $e->passengers || $e->cabins || $e->car || $e->train || $e->pickupInstructions || $e->dropoffInstructions || $e->furtherInfo || $e->importantInfo || $e->details || $e->docs || $e->images || $e->emergencyPhone || $e->address || $e->ports || $e->onboardCredit;
?>
<article class="vt-el vt-el--<?= e($e->kind) ?><?= $e->onRequest ? ' is-request' : '' ?>" id="el-<?= e($e->id) ?>">
  <div class="vt-el__row">
    <span class="vt-el__icon" aria-hidden="true"><?= View::kindIcon($e->kind) ?></span>
    <div class="vt-el__main">
      <span class="vt-el__kind"><?= e(View::kindLabel($e->kind)) ?><?= $e->onRequest ? ' · on request' : '' ?></span>
      <h3 class="vt-el__title"><?= e($displayTitle) ?></h3>
      <?php if ($e->kind === 'flight' && $e->carrierLogo !== ''): ?><span class="vt-logo vt-logo--inline"><img src="<?= e($e->carrierLogo) ?>" alt="<?= e($e->carrier ?: $e->carrierCode) ?>" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span><?php endif; ?>
      <?php if ($e->kind === 'cruise' && $e->operatorLogo !== ''): ?><span class="vt-logo vt-logo--inline"><img src="<?= e($e->operatorLogo) ?>" alt="<?= e($e->cruiseLine) ?>" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span><?php endif; ?>
      <?php if (!in_array($e->kind, ['flight', 'cruise'], true) && $showSupplier && $e->supplierLogo !== ''): ?><span class="vt-logo vt-logo--inline"><img src="<?= e($e->supplierLogo) ?>" alt="<?= e($e->supplier) ?>" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span><?php endif; ?>
      <?php if ($e->kind === 'flight' && ($e->from !== '' || $e->to !== '')): ?><p class="vt-el__route"><?= e($e->from) ?> to <?= e($e->to) ?></p><?php endif; ?>
      <?php if ($meta): ?><p class="vt-el__meta"><?= e(implode(' · ', $meta)) ?></p><?php endif; ?>
    </div>
    <?php if ($showTime): ?><time class="vt-el__time"><?= e($e->startTime) ?><?php if ($e->endTime !== '' && in_array($e->kind, ['flight', 'train', 'transfer'], true)): ?><small>arr <?= e($e->endTime) ?><?= $e->arrivesNextDay ? ' +1' : '' ?></small><?php endif; ?></time><?php endif; ?>
  </div>
  <?php if ($hasDetails): ?>
  <details class="vt-el__details">
    <summary><span>Details</span><?= icon('chevron') ?></summary>
    <div class="vt-el__panel">
      <?php if ($e->images): ?>
        <div class="vt-gallery" data-gallery>
          <?php foreach ($e->images as $img): ?><a href="<?= e($img['url']) ?>" data-lightbox><img src="<?= e($img['thumb']) ?>" alt="<?= e($img['name']) ?>" loading="lazy" decoding="async"></a><?php endforeach; ?>
        </div>
      <?php endif; ?>
      <dl class="vt-kv">
        <?php if ($showSupplier): ?><div><dt>Provided by</dt><dd><?= e($e->supplier) ?><?php if ($e->supplierLegalUrl !== ''): ?> <a class="vt-link vt-el__terms" href="<?= e($e->supplierLegalUrl) ?>" target="_blank" rel="noopener">Terms</a><?php endif; ?></dd></div><?php endif; ?>
        <?php if (!$e->supplierHidden && $e->supplierRef !== ''): ?><div><dt>Reference</dt><dd><?= e($e->supplierRef) ?></dd></div><?php endif; ?>
        <?php if ($e->kind === 'flight' && $e->pnr !== '' && !$trip->isQuote()): ?><div><dt>Airline booking ref</dt><dd><?= e($e->pnr) ?></dd></div><?php endif; ?>
        <?php if ($e->address !== ''): ?><div><dt>Address</dt><dd><?= e($e->address) ?> <a class="vt-link" href="<?= e(\VisionTrips\Integrations\Places::directionsUrl($e->title . ', ' . $e->address, $e->lat, $e->lng)) ?>" target="_blank" rel="noopener">Directions</a></dd></div><?php endif; ?>
        <?php if ($e->rating !== ''): ?><div><dt>Rating</dt><dd><?= e($e->rating) ?> star</dd></div><?php endif; ?>
        <?php foreach ($e->car as $k => $v): ?><div><dt><?= e($k) ?></dt><dd><?= e($v) ?></dd></div><?php endforeach; ?>
        <?php foreach ($e->train as $k => $v): ?><div><dt><?= e($k) ?></dt><dd><?= e($v) ?></dd></div><?php endforeach; ?>
        <?php if ($e->onboardCredit !== ''): ?><div><dt>Onboard credit</dt><dd><?= e($e->onboardCredit) ?></dd></div><?php endif; ?>
        <?php foreach ($e->details as $row): if ($row['long']) { continue; } ?><div><dt><?= e($row['label']) ?></dt><dd><?= raw($row['value']) ?></dd></div><?php endforeach; ?>
      </dl>
      <?php if ($e->cabins): ?>
        <h4 class="vt-h4">Your cabin</h4>
        <?php foreach ($e->cabins as $cabin): ?><dl class="vt-kv vt-kv--tight"><?php foreach ($cabin as $k => $v): ?><div><dt><?= e($k) ?></dt><dd><?= e($v) ?></dd></div><?php endforeach; ?></dl><?php endforeach; ?>
      <?php endif; ?>
      <?php if ($e->passengers && !$trip->isQuote()): ?>
        <h4 class="vt-h4">Travelling</h4>
        <ul class="vt-pax" role="list">
          <?php foreach ($e->passengers as $p): ?>
            <li><strong><?= e($p['name']) ?></strong><?php $bits = []; foreach ($p as $k => $v) { if ($k !== 'name' && $k !== 'Extras') { $bits[] = $k . ' ' . $v; } } if ($bits): ?><span><?= e(implode(' · ', $bits)) ?></span><?php endif; ?><?php if (!empty($p['Extras'])): ?><span class="vt-pax__extras"><?= e($p['Extras']) ?></span><?php endif; ?></li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
      <?php if ($e->ports && $e->kind === 'cruise'): ?>
        <h4 class="vt-h4">Ports of call</h4>
        <ol class="vt-ports" role="list">
          <?php foreach ($e->ports as $p): ?><li class="<?= $p['atSea'] ? 'is-sea' : '' ?>"><span class="vt-ports__day">Day <?= e($p['day']) ?></span><span class="vt-ports__port"><?= e($p['port']) ?></span><span class="vt-ports__times"><?= e(trim(($p['arrive'] !== '' ? 'Arrive ' . $p['arrive'] : '') . ($p['depart'] !== '' ? ' · Depart ' . $p['depart'] : ''), ' ·')) ?></span></li><?php endforeach; ?>
        </ol>
      <?php endif; ?>
      <?php if ($e->pickupInstructions !== ''): ?><div class="vt-longtext"><h4 class="vt-h4">Pick-up instructions</h4><?= raw($e->pickupInstructions) ?></div><?php endif; ?>
      <?php if ($e->dropoffInstructions !== ''): ?><div class="vt-longtext"><h4 class="vt-h4">Drop-off instructions</h4><?= raw($e->dropoffInstructions) ?></div><?php endif; ?>
      <?php if ($e->furtherInfo !== ''): ?><div class="vt-longtext"><?= raw($e->furtherInfo) ?></div><?php endif; ?>
      <?php if ($e->importantInfo !== ''): ?><div class="vt-longtext vt-longtext--important"><h4 class="vt-h4">Important</h4><?= raw($e->importantInfo) ?></div><?php endif; ?>
      <?php foreach ($e->details as $row): if (!$row['long']) { continue; } ?><div class="vt-longtext"><h4 class="vt-h4"><?= e($row['label']) ?></h4><?= raw($row['value']) ?></div><?php endforeach; ?>
      <?php if ($e->docs && !$trip->isQuote()): ?>
        <h4 class="vt-h4">Documents</h4>
        <ul class="vt-files" role="list"><?php foreach ($e->docs as $doc): ?><li><a href="<?= e($doc['url']) ?>" target="_blank" rel="noopener"><?= icon('doc') ?><?= e($doc['name']) ?></a></li><?php endforeach; ?></ul>
      <?php endif; ?>
      <?php if ($e->kind === 'flight' && $aiNotes && $e->carrierCode !== ''): ?>
        <?php $vm = get_defined_vars(); ?>
        <?= View::external('airline-' . strtolower($e->carrierCode), $preview, fn () => \VisionTrips\Rest\Api::airlineFragment($trip, $e->carrierCode, $vm), 'text', 'data-guide="1"') ?>
        <?php if ($e->fromCode !== '' && in_array($e->fromCountry, ['GB', 'UK', 'GBR'], true)): ?><?= View::external('airport-' . strtolower($e->fromCode), $preview, fn () => \VisionTrips\Rest\Api::airportFragment($trip, $e->fromCode, $vm), 'text', 'data-guide="1"') ?><?php endif; ?>
      <?php endif; ?>
      <?php if ($e->emergencyPhone !== ''): ?><p class="vt-el__emergency"><?= icon('phone') ?> <?= e($e->emergencyName !== '' ? $e->emergencyName : 'Supplier emergency line') ?>: <a href="<?= e(tel($e->emergencyPhone)) ?>"><?= e($e->emergencyPhone) ?></a></p><?php endif; ?>
      <?php if ($trip->protection->atolApplies() || $trip->isLive() || $protection['scheme'] === 'none'): ?><p class="vt-el__protection vt-el__protection--<?= e($protection['scheme']) ?>"><?= icon('shield') ?> <?= e($protection['label']) ?></p><?php endif; ?>
    </div>
  </details>
  <?php endif; ?>
</article>
