<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
/** @var \VisionTrips\Domain\Payment|null $payment */
$docTitle = $payment ? 'Receipt' : 'Receipts';
echo partial('documents/_open', get_defined_vars());
$list = $payment ? [$payment] : array_values(array_filter($trip->sortedPayments(), static fn ($p) => $p->isPaid() && !$p->isRefund() && !$p->isResort()));
?>
  <h1 class="vt-page__title"><?= $payment ? 'Payment receipt' : 'Payment receipts' ?></h1>
  <p class="vt-page__sub"><?= e($trip->name) ?> · <?= e($trip->ref) ?></p>
  <?php if (!$list): ?><p>No payments have been received yet.</p><?php endif; ?>
  <?php foreach ($list as $p): ?>
    <section class="vt-receipt">
      <dl class="vt-meta">
        <div><dt>Received from</dt><dd><?= e($p->travellerName !== '' ? $p->travellerName : ($trip->lead ? $trip->lead->name : 'Customer')) ?></dd></div>
        <div><dt>Receipt date</dt><dd><?= e($p->completed ? Dates::long($p->completed) : $issuedOn) ?></dd></div>
        <div><dt>Receipt number</dt><dd><?= e($p->reference !== '' ? $p->reference : $p->id) ?></dd></div>
        <div><dt>Payment method</dt><dd><?= e($p->method !== '' ? $p->method : $p->label()) ?></dd></div>
        <div><dt>Amount received</dt><dd class="vt-meta__big"><?= e($p->money()) ?></dd></div>
      </dl>
      <table class="vt-table vt-totals-table">
        <tbody>
          <tr><td>Total payable to us</td><td class="num"><?= e($trip->money($trip->total)) ?></td></tr>
          <tr><td>Paid to date</td><td class="num"><?= e($trip->money($trip->paid)) ?></td></tr>
          <tr class="vt-table__total"><td>Outstanding balance</td><td class="num"><?= e($trip->money($trip->balance)) ?></td></tr>
        </tbody>
      </table>
      <p class="vt-doc__note">This receipt confirms payment received towards your booking. Please keep it for your records.</p>
    </section>
  <?php endforeach; ?>
<?= partial('documents/_close', get_defined_vars()) ?>
