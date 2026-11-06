<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$payments = $trip->sortedPayments();
$pct = $trip->paidPercent();
$isQuote = $trip->isQuote();
$hasPayNow = false;
$showBank = $brand->trustAccountNumber !== '' && !$isQuote && $trip->balance > 0.009;
$mintReady = \VisionTrips\Integrations\Mint::enabled() && $brand->mintConfigured && preg_match('/^BK\./', $trip->mintBookingId) === 1;
$canShowPayNow = static fn (\VisionTrips\Domain\Payment $p) => !$p->isPaid() && !$p->isResort() && $p->isCustomerPayment() && $p->amount > 0 && ($p->link !== '' || $mintReady) && (!$isQuote || $p->showOnQuote);
?>
<section class="vt-section" id="payments" aria-labelledby="pay-h">
  <h2 class="vt-h2" id="pay-h"><?= $isQuote ? 'Price and payment plan' : 'Payments' ?></h2>
  <div class="vt-totals">
    <div class="vt-totals__main">
      <span class="vt-totals__label"><?= $isQuote ? 'Total price' : 'Total payable to us' ?></span>
      <strong class="vt-totals__amount"><?= e($trip->altAmount > 0 ? \VisionTrips\Support\Str::money($trip->altAmount, $trip->altCurrencyType) : $trip->money($trip->total)) ?></strong>
      <?php if ($trip->totalInclResort > 0 && abs($trip->totalInclResort - $trip->total) > 0.01): ?><span class="vt-totals__note"><strong>Total cost of your trip <?= e($trip->money($trip->totalInclResort)) ?></strong>, including <?= e($trip->money($trip->totalInclResort - $trip->total)) ?> paid locally to suppliers during the trip.</span><?php endif; ?>
    </div>
    <?php if (!$isQuote && $trip->altAmount <= 0): ?>
      <div class="vt-totals__split">
        <div><span>Paid</span><strong><?= e($trip->money($trip->paid)) ?></strong></div>
        <div><span>Balance</span><strong><?= e($trip->money($trip->balance)) ?></strong></div>
      </div>
      <div class="vt-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= e($pct) ?>" aria-label="<?= e($pct) ?>% paid"><span style="width:<?= e($pct) ?>%"></span></div>
      <?php if ($trip->balance > 0.009 && $trip->balanceDueDate): ?><p class="vt-totals__due">Balance due by <strong><?= e(Dates::long($trip->balanceDueDate)) ?></strong></p><?php elseif ($trip->balance <= 0.009 && $trip->total > 0): ?><p class="vt-totals__due vt-totals__due--paid"><?= icon('check') ?> Paid in full. Thank you.</p><?php endif; ?>
    <?php endif; ?>
  </div>

  <?php if ($payments): ?>
    <ul class="vt-payments" role="list">
      <?php foreach ($payments as $p): $paid = $p->isPaid(); $resort = $p->isResort(); $refund = $p->isRefund(); $overdue = $p->isOverdue(); ?>
        <li class="vt-pay<?= $paid ? ' is-paid' : '' ?><?= $overdue ? ' is-overdue' : '' ?><?= $resort ? ' is-resort' : '' ?><?= $refund ? ' is-refund' : '' ?>">
          <div class="vt-pay__main">
            <strong><?= e($p->money()) ?></strong>
            <span class="vt-pay__label"><?= e($p->label()) ?><?php if ($paid && $p->completed): ?> · received <?= e(Dates::medium($p->completed)) ?><?php elseif (!$paid && !$resort && $p->due): $dueIn = Dates::daysBetween(Dates::now(), $p->due); ?> · due <?= e(Dates::medium($p->due)) ?><?php if ($dueIn !== null && $dueIn >= 0 && $dueIn <= 30): ?> <em class="vt-pay__soon"><?= $dueIn === 0 ? 'today' : 'in ' . e($dueIn) . ' day' . ($dueIn === 1 ? '' : 's') ?></em><?php endif; ?><?php endif; ?></span>
            <?php if ($resort): ?><span class="vt-pay__note"><?= e($p->resortReason !== '' ? $p->resortReason . '. ' : '') ?>Paid locally during your trip in local currency; the amount shown is a guide and may vary with exchange rates.</span><?php endif; ?>
          </div>
          <div class="vt-pay__action">
            <?php if ($canShowPayNow($p)): $hasPayNow = true; ?><?php if ($p->link !== ''): ?><a class="vt-btn vt-btn--primary vt-btn--sm" href="<?= e($p->link) ?>" rel="noopener">Pay now</a><?php else: ?><button type="button" class="vt-btn vt-btn--primary vt-btn--sm" data-pay-payment="<?= e($p->id) ?>">Pay now</button><?php endif; ?>
            <?php elseif ($paid && !$refund && !$isQuote): ?><a class="vt-btn vt-btn--ghost vt-btn--sm" href="<?= e($urls['receipts']) ?><?= e($p->id) ?>/"><?= icon('doc') ?> Receipt</a>
            <?php elseif ($overdue): ?><span class="vt-pay__flag">Overdue</span>
            <?php endif; ?>
          </div>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php elseif (!$isQuote): ?>
    <p class="vt-empty">Your payment schedule will appear here. Speak to us for a breakdown of when each payment is due.</p>
  <?php endif; ?>

  <?php if ($customPay): ?>
    <form class="vt-custompay" data-custom-pay>
      <label class="vt-field"><span>Pay a different amount (up to <?= e($trip->money($trip->balance)) ?>)</span><div class="vt-field__money"><span>£</span><input type="number" name="amount" min="0.01" max="<?= e(number_format($trip->balance, 2, '.', '')) ?>" step="0.01" placeholder="0.00" inputmode="decimal"></div></label>
      <button type="submit" class="vt-btn vt-btn--primary vt-btn--sm" disabled>Pay now</button>
      <p class="vt-accept__error" data-pay-error role="alert" hidden></p>
    </form>
  <?php endif; ?>

  <?php if ($showBank || ($hasPayNow && !$isQuote)): ?>
    <details class="vt-more vt-bank">
      <summary><span>Prefer to pay by bank transfer?</span><?= icon('chevron') ?></summary>
      <div class="vt-bank__body">
        <?php if ($hasPayNow): ?><p>Choose <strong>Pay now</strong> above and select pay by bank: you'll be taken to your own banking app to approve a transfer, with the reference filled in for you.</p><?php endif; ?>
        <?php if ($showBank): ?>
          <dl class="vt-kv vt-kv--tight">
            <?php if ($brand->trustAccountName !== ''): ?><div><dt>Account name</dt><dd><?= e($brand->trustAccountName) ?></dd></div><?php endif; ?>
            <?php if ($brand->trustSortCode !== ''): ?><div><dt>Sort code</dt><dd><?= e($brand->trustSortCode) ?></dd></div><?php endif; ?>
            <div><dt>Account number</dt><dd><?= e($brand->trustAccountNumber) ?></dd></div>
            <div><dt>Reference</dt><dd><strong><?= e($trip->ref) ?></strong></dd></div>
          </dl>
          <p class="vt-small">Quote the reference exactly so we can match your payment, and let us know once it's sent.</p>
        <?php endif; ?>
      </div>
    </details>
  <?php endif; ?>
</section>
