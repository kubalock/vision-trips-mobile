<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** Travel wallet: what gets screenshotted at the airport — tickets, vouchers, addresses, times, emergency numbers. */
/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = 'Travel wallet';
echo partial('documents/_open', get_defined_vars());
$tel = static fn (string $n) => 'tel:' . preg_replace('/[^0-9+]/', '', $n);
?>
  <h1 class="vt-page__title">Travel wallet</h1>
  <p class="vt-page__sub"><?= e($trip->name) ?> · <?= e($trip->dateRange()) ?> · <?= e($trip->ref) ?></p>

  <h2 class="vt-page__h2">If you need us</h2>
  <dl class="vt-meta">
    <?php if ($brand->emergencyPhone !== '' || $trip->emergencyPhone !== ''): ?><div><dt>Out of hours (while travelling)</dt><dd><a href="<?= e($tel($brand->emergencyPhone ?: $trip->emergencyPhone)) ?>"><?= e($brand->emergencyPhone ?: $trip->emergencyPhone) ?></a></dd></div><?php endif; ?>
    <?php if ($brand->phone !== ''): ?><div><dt><?= e($brand->name) ?></dt><dd><a href="<?= e($tel($brand->phone)) ?>"><?= e($brand->phone) ?></a></dd></div><?php endif; ?>
    <?php if ($brand->email !== ''): ?><div><dt>Email</dt><dd><?= e($brand->email) ?></dd></div><?php endif; ?>
  </dl>

  <?php if ($trip->travellers): ?>
  <h2 class="vt-page__h2">Travelling</h2>
  <p><?= e(implode(', ', array_map(static fn ($t) => $t->name, $trip->travellers))) ?></p>
  <?php endif; ?>

  <?php foreach ($trip->days() as $day): ?>
    <h3 class="vt-page__day"><?= e(Dates::long($day['date'])) ?> <span>Day <?= e($day['day'] ?? $day['n'] ?? '') ?></span></h3>
    <?php foreach ($day['items'] as $e): ?>
      <article class="vt-doc__el">
        <div class="vt-doc__el-head"><strong><?= e($e->shortTitle()) ?></strong><span><?= e(View::kindLabel($e->kind)) ?><?= $e->startTime !== '' ? ' · ' . e($e->startTime) : '' ?><?= $e->endTime !== '' && in_array($e->kind, ['flight', 'train', 'transfer'], true) ? ' – ' . e($e->endTime) : '' ?></span></div>
        <dl class="vt-doc__kv">
          <?php if ($e->kind === 'flight'): ?>
            <?php if ($e->from !== ''): ?><div><dt>From</dt><dd><?= e($e->from) ?><?= $e->fromCode !== '' ? ' (' . e($e->fromCode) . ')' : '' ?></dd></div><?php endif; ?>
            <?php if ($e->to !== ''): ?><div><dt>To</dt><dd><?= e($e->to) ?><?= $e->toCode !== '' ? ' (' . e($e->toCode) . ')' : '' ?></dd></div><?php endif; ?>
            <?php if ($e->flightNo !== ''): ?><div><dt>Flight</dt><dd><?= e(trim($e->carrier . ' ' . $e->flightNo)) ?></dd></div><?php endif; ?>
            <?php foreach ($e->passengers as $p): ?><div><dt><?= e($p['name']) ?></dt><dd><?= e(trim(implode(' · ', array_filter([($p['Booking ref'] ?? '') !== '' ? 'Ref ' . $p['Booking ref'] : '', ($p['Seat'] ?? '') !== '' ? 'Seat ' . $p['Seat'] : '', $p['Class'] ?? ''])))) ?: '—' ?></dd></div><?php endforeach; ?>
          <?php elseif ($e->kind === 'stay'): ?>
            <?php if ($e->address !== ''): ?><div><dt>Address</dt><dd><?= e($e->address) ?></dd></div><?php endif; ?>
            <?php if ($e->rooms): ?><div><dt>Room</dt><dd><?= e(implode('; ', $e->rooms)) ?></dd></div><?php endif; ?>
            <?php if ($e->nights): ?><div><dt>Nights</dt><dd><?= e((string) $e->nights) ?></dd></div><?php endif; ?>
          <?php elseif ($e->kind === 'transfer'): ?>
            <?php if ($e->from !== ''): ?><div><dt>Pick up</dt><dd><?= e($e->from) ?></dd></div><?php endif; ?>
            <?php if ($e->to !== ''): ?><div><dt>Drop off</dt><dd><?= e($e->to) ?></dd></div><?php endif; ?>
          <?php elseif ($e->kind === 'cruise'): ?>
            <?php if ($e->ship !== ''): ?><div><dt>Ship</dt><dd><?= e($e->ship) ?></dd></div><?php endif; ?>
            <?php if ($e->departPort !== ''): ?><div><dt>Embark</dt><dd><?= e($e->departPort) ?></dd></div><?php endif; ?>
            <?php foreach ($e->cabins as $c): ?><div><dt>Cabin</dt><dd><?= e(implode(', ', array_map(static fn ($k, $v) => $k . ' ' . $v, array_keys($c), $c))) ?></dd></div><?php endforeach; ?>
          <?php endif; ?>
          <?php if ($e->supplierRef !== '' && empty($hideSuppliers)): ?><div><dt>Reference</dt><dd><?= e($e->supplierRef) ?></dd></div><?php endif; ?>
          <?php if ($e->emergencyPhone !== ''): ?><div><dt>Emergency (<?= e($e->emergencyName ?: 'supplier') ?>)</dt><dd><a href="<?= e($tel($e->emergencyPhone)) ?>"><?= e($e->emergencyPhone) ?></a></dd></div><?php endif; ?>
        </dl>
        <?php if ($e->pickupInstructions !== ''): ?><div class="vt-doc__long"><?= raw($e->pickupInstructions) ?></div><?php endif; ?>
        <?php if ($e->docs): ?><p class="vt-doc__note">Documents: <?php foreach ($e->docs as $i => $att): ?><?= $i ? ' · ' : '' ?><a href="<?= e($att['url']) ?>" target="_blank" rel="noopener"><?= e($att['name'] ?: 'file') ?></a><?php endforeach; ?></p><?php endif; ?>
      </article>
    <?php endforeach; ?>
  <?php endforeach; ?>

  <h2 class="vt-page__h2">Your documents</h2>
  <p class="vt-doclist"><a href="<?= e($urls['confirmation']) ?>">Booking confirmation</a><?php if ($trip->atolCertificateAvailable()): ?> · <a href="<?= e($urls['atol']) ?>">ATOL certificate</a><?php endif; ?></p>
  <p class="vt-doc__note">Keep this page open or save it as a PDF before you travel — it works offline once saved.</p>
<?= partial('documents/_close', get_defined_vars()) ?>
