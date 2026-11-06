<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = 'Front file (agent)';
echo partial('documents/_open', get_defined_vars());
?>
  <h1 class="vt-page__title"><?= e($trip->lead ? $trip->lead->name : $trip->name) ?></h1>
  <p class="vt-page__sub"><?= e($trip->ref) ?> · <?= e($trip->name) ?> · <?= e($trip->dateRange()) ?> · <?= e($trip->status) ?></p>
  <dl class="vt-meta">
    <div><dt>Company</dt><dd><?= e($brand->memberCompany) ?> (<?= e($brand->memberNumber) ?>)</dd></div>
    <div><dt>Passengers</dt><dd><?= e($trip->totalPax) ?></dd></div>
    <div><dt>Total price</dt><dd><?= e($trip->money($trip->total)) ?></dd></div>
    <?php if ($trip->customerEmail !== ''): ?><div><dt>Email</dt><dd><?= e($trip->customerEmail) ?></dd></div><?php endif; ?>
    <?php if ($trip->customerPhone !== ''): ?><div><dt>Phone</dt><dd><?= e($trip->customerPhone) ?></dd></div><?php endif; ?>
    <?php if ($trip->customerPostcode !== ''): ?><div><dt>Postcode</dt><dd><?= e($trip->customerPostcode) ?></dd></div><?php endif; ?>
    <div><dt>ATOL</dt><dd><?= e($trip->atolSelect ?: '—') ?> <?= e($trip->protection->holderLabel()) ?></dd></div>
  </dl>
  <?php if ($trip->travellers): ?>
  <h2 class="vt-page__h2">Passengers</h2>
  <table class="vt-table vt-table--rows"><thead><tr><th>Name</th><th>Date of birth</th><th class="num">Age</th></tr></thead><tbody>
    <?php foreach ($trip->travellers as $t): ?><tr><td><?= e($t->name) ?></td><td><?= e($t->dob ? $t->dob->format('d/m/Y') : '') ?></td><td class="num"><?= e($t->age ?? '') ?></td></tr><?php endforeach; ?>
  </tbody></table>
  <?php endif; ?>
  <h2 class="vt-page__h2">Elements <button type="button" class="vt-doc__toggle" onclick="document.body.classList.toggle('show-net')">Show/hide net</button></h2>
  <table class="vt-table vt-table--rows"><thead><tr><th>Element</th><th>Status</th><th>Supplier</th><th>Ref</th><th>Date</th><th class="num net">Net</th><th class="num">Gross</th></tr></thead><tbody>
    <?php foreach ($trip->activeElements() as $e): ?><tr><td><?= e($e->title) ?></td><td><?= e($e->status) ?></td><td><?= e($e->supplier) ?></td><td><?= e($e->supplierRef) ?></td><td><?= e(Dates::numeric($e->start)) ?></td><td class="num net"><?= e(isset($e->raw['Net']) ? $trip->money((float) $e->raw['Net']) : '') ?></td><td class="num"><?= e(isset($e->raw['Gross']) ? $trip->money((float) $e->raw['Gross']) : '') ?></td></tr><?php endforeach; ?>
  </tbody></table>
  <h2 class="vt-page__h2">Payments</h2>
  <table class="vt-table vt-table--rows"><thead><tr><th>Amount</th><th>Type</th><th>Status</th><th>Due</th><th>Completed</th></tr></thead><tbody>
    <?php foreach ($trip->sortedPayments() as $p): ?><tr><td><?= e($p->money()) ?></td><td><?= e($p->type) ?><?= $p->customerType !== '' ? ' · ' . e($p->customerType) : '' ?></td><td><?= e($p->status) ?></td><td><?= e(Dates::numeric($p->due)) ?></td><td><?= e(Dates::numeric($p->completed)) ?></td></tr><?php endforeach; ?>
  </tbody></table>
<?= partial('documents/_close', get_defined_vars()) ?>
