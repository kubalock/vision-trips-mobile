<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$atol = $trip->atolCertificateAvailable();
$tta = $trip->protection->isTta && $trip->isLive();
$receipts = array_values(array_filter($trip->payments, static fn ($p) => $p->isPaid() && !$p->isRefund()));
?>
<section class="vt-section" id="documents" aria-labelledby="docs-h">
  <h2 class="vt-h2" id="docs-h">Your documents</h2>
  <ul class="vt-docs" role="list">
    <li><a href="<?= e($urls['confirmation']) ?>"><?= icon('doc') ?><span><strong>Booking confirmation</strong><em>Full itinerary, payments and important information</em></span><?= icon('arrow') ?></a></li>
    <?php if ($atol): ?><li><a href="<?= e($urls['atol']) ?>"><?= icon('shield') ?><span><strong>ATOL certificate</strong><em>Your financial protection certificate</em></span><?= icon('arrow') ?></a></li><?php endif; ?>
    <?php if ($tta): ?><li><a href="<?= e($urls['docs']) ?>guarantee/"><?= icon('shield') ?><span><strong>Safe Seat Plan guarantee</strong><em>Travel Trust Association certificate</em></span><?= icon('arrow') ?></a></li><?php endif; ?>
    <?php if (\VisionTrips\Settings::module('wallet')): ?><li><a href="<?= e($urls['docs']) ?>wallet/"><?= icon('wallet') ?><span><strong>Travel wallet</strong><em>Tickets, vouchers, addresses and emergency numbers on one page</em></span><?= icon('arrow') ?></a></li><?php endif; ?>
    <?php if (empty($traveller)): ?><li><a href="<?= e($urls['invoice']) ?>"><?= icon('card') ?><span><strong>Invoice</strong><em>Statement of what's been paid and what's due</em></span><?= icon('arrow') ?></a></li><?php endif; ?>
    <?php if ($receipts): ?><li><a href="<?= e($urls['receipts']) ?>"><?= icon('check') ?><span><strong>Receipts</strong><em><?= e(count($receipts)) ?> payment<?= count($receipts) === 1 ? '' : 's' ?> received</em></span><?= icon('arrow') ?></a></li><?php endif; ?>
    <?php foreach ($trip->activeElements() as $e): foreach ($e->docs as $doc): ?>
      <li><a href="<?= e($doc['url']) ?>" target="_blank" rel="noopener"><?= icon('ticket') ?><span><strong><?= e($doc['name']) ?></strong><em><?= e($e->title) ?></em></span><?= icon('external') ?></a></li>
    <?php endforeach; endforeach; ?>
  </ul>
  <?php if (!$trip->supplierTicketsReceived && $trip->hasFlight() && $trip->isLive()): ?><p class="vt-docs__note">Flight tickets and e-documents from suppliers appear here as they are issued, usually in the weeks before departure.</p><?php endif; ?>
</section>
