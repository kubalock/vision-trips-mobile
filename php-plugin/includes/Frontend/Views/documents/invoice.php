<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = 'Invoice';
echo partial('documents/_open', get_defined_vars());
$lines = [];
$paidTotal = 0.0;
$dueTotal = 0.0;
$nextDue = '';
foreach ($trip->sortedPayments() as $p) {
    if ($p->amount <= 0 || $p->isResort()) {
        continue;
    }
    $lines[] = $p;
    if ($p->isPaid()) {
        $paidTotal += $p->isRefund() ? -$p->amount : $p->amount;
    } elseif ($p->isCustomerPayment()) {
        $dueTotal += $p->amount;
        if ($nextDue === '' && $p->due) {
            $nextDue = Dates::long($p->due);
        }
    }
}
?>
  <h1 class="vt-page__title">Invoice</h1>
  <p class="vt-page__sub"><?= e($trip->name) ?></p>
  <dl class="vt-meta">
    <div><dt>Invoice no.</dt><dd><?= e($invoiceNo) ?></dd></div>
    <div><dt>Issue date</dt><dd><?= e($issued) ?></dd></div>
    <div><dt>Booking reference</dt><dd><?= e($trip->ref) ?></dd></div>
    <div><dt>Departure</dt><dd><?= e(Dates::numeric($trip->departs)) ?></dd></div>
  </dl>
  <div class="vt-twocol">
    <div class="vt-box"><span class="vt-box__k">Issued by</span><strong><?= e($brand->name) ?></strong><?php if ($brand->memberCompany !== '' && strcasecmp($brand->memberCompany, $brand->name) !== 0): ?><span><?= e($brand->memberCompany) ?></span><?php endif; ?><?php if ($brand->memberOffice): ?><span><?= e(implode(', ', $brand->memberOffice)) ?></span><?php endif; ?><?php if ($brand->memberNumber !== ''): ?><span>Member no. <?= e($brand->memberNumber) ?></span><?php endif; ?><?php if ($brand->memberVatNo !== ''): ?><span>VAT no. <?= e($brand->memberVatNo) ?></span><?php endif; ?></div>
    <div class="vt-box"><span class="vt-box__k">Invoice to</span><strong><?= e($trip->lead ? $trip->lead->name : 'Customer') ?></strong><?php if ($verified && $trip->customerEmail !== ''): ?><span><?= e($trip->customerEmail) ?></span><?php endif; ?></div>
  </div>
  <table class="vt-table vt-table--rows">
    <thead><tr><th>Description</th><th>Due</th><th>Status</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <?php if (!$lines): ?><tr><td colspan="4">No invoiceable payment lines on this booking.</td></tr><?php endif; ?>
      <?php foreach ($lines as $p): ?><tr><td><strong><?= e($p->label()) ?></strong><br><span class="muted"><?= e($trip->name) ?></span></td><td><?= e(Dates::numeric($p->due)) ?></td><td><?= e($p->isPaid() ? 'Paid' : $p->status) ?></td><td class="num"><?= e(($p->isRefund() ? '−' : '') . $p->money()) ?></td></tr><?php endforeach; ?>
    </tbody>
  </table>
  <div class="vt-twocol vt-twocol--totals">
    <div>
      <p class="vt-doc__note">This invoice relates to booking <strong><?= e($trip->ref) ?></strong><?= $trip->departs ? ' departing ' . e(Dates::long($trip->departs)) : '' ?>.<?= $nextDue !== '' ? ' Next payment due <strong>' . e($nextDue) . '</strong>.' : '' ?></p>
      <?php if ($brand->trustAccountNumber !== ''): ?><p class="vt-doc__bank"><strong>Payment details:</strong> <?= e($brand->trustAccountName) ?><?= $brand->trustSortCode !== '' ? ', sort code ' . e($brand->trustSortCode) : '' ?>, account <?= e($brand->trustAccountNumber) ?>. Reference <strong><?= e($trip->ref) ?></strong>.</p><?php endif; ?>
    </div>
    <table class="vt-table vt-totals-table">
      <tbody>
        <tr><td>Paid</td><td class="num"><?= e($trip->money($paidTotal)) ?></td></tr>
        <tr><td>Outstanding</td><td class="num"><?= e($trip->money($dueTotal)) ?></td></tr>
        <tr class="vt-table__total"><td>Invoice total</td><td class="num"><?= e($trip->money($trip->total)) ?></td></tr>
      </tbody>
    </table>
  </div>
<?= partial('documents/_close', get_defined_vars()) ?>
