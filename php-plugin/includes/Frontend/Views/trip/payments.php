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
// On a quotation nothing is paid directly: the deposit row leads into the accept flow (which takes the deposit at the end),
// so the process is the same whether the customer starts at the top of the page or at the price.
$canShowPayNow = static fn (\VisionTrips\Domain\Payment $p) => !$isQuote && !$p->isPaid() && !$p->isResort() && $p->isCustomerPayment() && $p->amount > 0 && ($p->link !== '' || $mintReady);
$quoteDeposit = $isQuote && !empty($quoteAccept) ? $trip->depositPayment() : null;
?>
<section class="vt-section" id="payments" aria-labelledby="pay-h">
  <h2 class="vt-h2" id="pay-h"><?= $isQuote ? 'Price and payment plan' : 'Payments' ?></h2>
  <div class="vt-totals">
    <div class="vt-totals__main">
      <span class="vt-totals__label"><?= $isQuote ? 'Total price' : 'Total payable to us' ?></span>
      <strong class="vt-totals__amount"><?= e($trip->altAmount > 0 ? \VisionTrips\Support\Str::money($trip->altAmount, $trip->altCurrencyType) : $trip->money($trip->total)) ?></strong>
      <?php if ($trip->perPerson() > 0 && count($trip->travellers) > 1): ?><span class="vt-totals__pp"><?= e($trip->money($trip->perPerson())) ?> per person · <?= e((string) count($trip->travellers)) ?> travellers</span><?php endif; ?>
      <?php if ($trip->totalInclResort > 0 && abs($trip->totalInclResort - $trip->total) > 0.01): ?><span class="vt-totals__note"><strong>Total cost of your trip <?= e($trip->money($trip->totalInclResort)) ?></strong>, including <?= e($trip->money($trip->totalInclResort - $trip->total)) ?> paid locally to suppliers during the trip.</span><?php endif; ?>
    </div>
    <?php if (!$isQuote && $trip->altAmount <= 0): ?>
      <div class="vt-totals__split">
        <div><span>Paid</span><strong><?= e($trip->money($trip->paid)) ?></strong></div>
        <div><span>Balance</span><strong><?= e($trip->money($trip->balance)) ?></strong></div>
      </div>
      <div class="vt-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= e($pct) ?>" aria-label="<?= e($pct) ?>% paid"><span style="width:<?= e($pct) ?>%"></span></div>
      <?php if ($isQuote && !empty($quoteAccept)): ?>
      <div class="vt-totals__accept">
        <div><strong>Happy with everything?</strong><span>Accepting takes about a minute, and nothing is charged until you confirm the deposit.</span></div>
        <div class="vt-totals__accept-btns"><a class="vt-btn vt-btn--primary" href="#accept-now" data-open-accept>Accept and pay deposit</a><a class="vt-btn vt-btn--ghost" href="#ask-top" data-ask>Ask a question</a><a class="vt-btn vt-btn--ghost" href="<?= e($urls['confirmation']) ?>" target="_blank" rel="noopener"><?= icon('download') ?> Save as PDF</a></div>
      </div>
      <?php endif; ?>
      <?php if ($trip->loyaltyEnabled && ($trip->loyaltyPoints > 0 || $trip->pointsAvailable > 0)):
        $pts = number_format($trip->loyaltyPoints) . ' loyalty ' . ($trip->loyaltyPoints === 1 ? 'point' : 'points');
        $home = $trip->returns && $trip->returns < Dates::now();
        if ($trip->loyaltyPoints <= 0) {
            $earn = '';
        } elseif ($trip->isQuote()) {
            $earn = 'Book with us and earn <strong>' . e($pts) . '</strong>.';
        } elseif ($trip->loyaltyAwarded) {
            $earn = 'You earned <strong>' . e($pts) . '</strong> with this trip.';
        } elseif ($home) {
            $earn = '<strong>' . e($pts) . '</strong> from this trip will be credited shortly.';
        } else {
            $earn = 'This trip earns you <strong>' . e($pts) . '</strong>' . ($trip->loyaltyReturnDate ? ', credited after you return on ' . e(Dates::medium($trip->loyaltyReturnDate)) : ', credited after you return') . '.';
        }
        $have = $trip->pointsAvailable > 0 ? 'You have <strong>' . e(number_format($trip->pointsAvailable)) . ' points</strong> to put towards ' . ($trip->balance > 0.009 && !$trip->isQuote() ? 'this balance' : 'your next trip') . ($trip->pointsValue > 0 ? ' (worth ' . e($trip->money($trip->pointsValue)) . ')' : '') . '.' : '';
      ?><p class="vt-totals__loyalty"><?= icon('star') ?><span><?= $earn ?><?= $earn !== '' && $have !== '' ? ' ' : '' ?><?= $have ?><?php if ($trip->pointsAvailable > 0 && $trip->balance > 0.009 && !$trip->isQuote()): ?> <a class="vt-link" href="#help" data-ask data-ask-prefill="I'd like to put my loyalty points towards this booking.">Use them on this trip</a><?php endif; ?></span></p><?php endif; ?>
      <?php if ($trip->balance > 0.009 && $trip->balanceDueDate): ?><p class="vt-totals__due">Balance due by <strong><?= e(Dates::long($trip->balanceDueDate)) ?></strong></p><?php elseif ($trip->balance <= 0.009 && $trip->total > 0): ?><p class="vt-totals__due vt-totals__due--paid"><?= icon('check') ?> Paid in full. Thank you.</p><?php endif; ?>
    <?php endif; ?>
  </div>

  <?php if ($payments): ?>
    <ul class="vt-payments" role="list">
      <?php foreach ($payments as $p): $paid = $p->isPaid(); $resort = $p->isResort(); $refund = $p->isRefund(); $overdue = $p->isOverdue(); ?>
        <?php $points = $p->isPointsPayment(); ?>
        <li class="vt-pay<?= $paid ? ' is-paid' : '' ?><?= $overdue ? ' is-overdue' : '' ?><?= $resort ? ' is-resort' : '' ?><?= $refund ? ' is-refund' : '' ?><?= $points ? ' is-points' : '' ?>">
          <div class="vt-pay__main">
            <strong><?php if ($points): ?><?= icon('star') ?> <?= e($p->pointsLabel()) ?><?php else: ?><?= e($p->money()) ?><?php endif; ?></strong>
            <span class="vt-pay__label"><?= e($points ? 'Loyalty points redeemed' . ($p->label() !== '' && stripos($p->label(), 'loyalty') === false ? ' · ' . $p->label() : '') : $p->label()) ?><?php if ($paid && $p->completed): ?> · received <?= e(Dates::medium($p->completed)) ?><?php elseif (!$paid && !$resort && $p->due): $dueIn = Dates::daysBetween(Dates::now(), $p->due); ?> · due <?= e(Dates::medium($p->due)) ?><?php if ($dueIn !== null && $dueIn >= 0 && $dueIn <= 30): ?> <em class="vt-pay__soon"><?= $dueIn === 0 ? 'today' : 'in ' . e($dueIn) . ' day' . ($dueIn === 1 ? '' : 's') ?></em><?php endif; ?><?php endif; ?></span>
            <?php if ($resort): ?><span class="vt-pay__note"><?= e($p->resortReason !== '' ? $p->resortReason . '. ' : '') ?>Paid locally during your trip in local currency; the amount shown is a guide and may vary with exchange rates.</span><?php endif; ?>
          </div>
          <div class="vt-pay__action">
            <?php if ($quoteDeposit && $p->id === $quoteDeposit->id): ?><a class="vt-btn vt-btn--primary vt-btn--sm" href="#accept-now" data-open-accept>Accept and pay deposit</a><?php endif; ?>
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
