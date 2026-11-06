<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Atol $atol */
/** @var \VisionTrips\Domain\Trip $trip */
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>ATOL Certificate — <?= e($trip->ref) ?></title>
<style>:root{--vt-accent:<?= e($accent) ?>;--accent-ink:<?= e(View::contrastInk($accent)) ?>}</style>
<?php if (!empty($preview)): ?><style><?= file_get_contents(VISION_TRIPS_DIR . 'assets/css/documents.css') ?></style><?php else: ?><link rel="stylesheet" href="<?= e(VISION_TRIPS_URL . 'assets/css/documents.css?ver=' . VISION_TRIPS_VERSION) ?>"><?php endif; ?>
</head>
<body class="vt-doc vt-doc--atol">
<div class="vt-doc__bar"><a class="vt-doc__back" href="<?= e($back) ?>">Back to your trip</a><span class="vt-doc__barttl">ATOL Certificate</span><button type="button" class="vt-doc__print" onclick="window.print()"><?= icon('print') ?> Print / save PDF</button></div>
<button type="button" class="vt-doc__fab" onclick="window.print()" aria-label="Print or save as PDF"><?= icon('print') ?> Print</button>
<article class="vt-atol">
  <p class="vt-atol__note">This is an important document. Make sure that you take it with you when you travel.</p>
  <h1 class="vt-atol__title">ATOL Certificate</h1>
  <p class="vt-atol__h2">This confirms that your money is protected by the ATOL scheme if your travel company collapses.</p>
  <p class="vt-atol__p">This certificate sets out how the ATOL scheme will protect the people named on it for the parts of their trip listed below.</p>
  <section class="vt-atol__main">
    <div class="vt-atol__row"><strong>Who is protected?</strong><span>Number of passengers: <?= e($atol->passengerCount) ?></span></div>
    <p><?= e($atol->passengerNames) ?></p>
    <strong>What is protected?</strong>
    <p><?= e($atol->whatsCovered) ?><br><?= e($atol->flightDetails) ?></p>
    <?php if (!$atol->flightOnly): ?><p>You can find more detailed information on your booking, including price, on the confirmation you will receive from <strong><?= e($atol->protectorName) ?></strong>.</p><?php endif; ?>
    <strong>Who is protecting your <?= $atol->flightOnly ? 'flight' : 'trip' ?>?</strong>
    <p><?= e($atol->protectorName) ?> – ATOL No. <?= e($atol->atolNumber) ?><br>Booking Reference <?= e($atol->bookingRef) ?></p>
    <?php if ($atol->flightOnly): ?><strong>ATOL protected cost</strong><p><?= e($atol->totalCost) ?></p><?php endif; ?>
    <h2 class="vt-atol__center">Your protection</h2>
    <?php if ($atol->flightOnly): ?>
      <p>You are protected from when you were given this certificate until you return to the UK. If <strong><?= e($atol->protectorName) ?></strong> stops trading, the passengers named above will either:</p>
      <p class="vt-atol__indent">1. be returned to the UK; or<br>2. receive a refund for the amount above (or your deposit if that is all you have paid so far).</p>
    <?php else: ?>
      <p>You are protected from when you were given this certificate to the end of your trip.</p>
      <p>If <strong><?= e($atol->protectorName) ?></strong> stops trading, the passengers named above will either:</p>
      <p class="vt-atol__indent">1. take and complete their trip; or<br>2. receive a refund.</p>
    <?php endif; ?>
    <p>Your protection depends on the terms of the ATOL scheme and the specifics of the ATOL holder failure (available at www.atol.org.uk).</p>
    <p>If <strong><?= e($atol->protectorName) ?></strong> stops trading, you must follow the instructions at www.atol.org.uk (where there will be details of repatriation arrangements, and information on how people can claim their money back) or you can call (+44) 333 103 6350.</p>
    <?php if ($atol->flightOnly): ?><h2 class="vt-atol__center">Warning</h2><p>This certificate only protects the above flights you have booked. Any other travel services you booked are not protected by this certificate.</p><?php endif; ?>
  </section>
  <section class="vt-atol__legal">
    By issuing this ATOL Certificate, under Regulation 17 of the Civil Aviation (Air Travel Organisers' Licensing) Regulations 2012 (as amended), <strong><?= e($atol->protectorName) ?></strong> confirms that the trip to which it applies is sold in line with the ATOL held by the organiser named above.<br>
    The ATOL scheme is run by the Civil Aviation Authority and paid for by the Air Travel Trust. To see what that is and what you can expect, together with full information on its terms and conditions go to www.atol.org.uk.<br>
    As well as the protection of the ATOL scheme, you have protection under the Package Travel and Linked Travel Arrangements Regulations. For more information see www.direct.gov.uk in the Travel and Transport section.
  </section>
  <table class="vt-atol__tbl"><thead><tr><th>Unique reference number:</th><th>Date of issue:</th><th>ATOL Certificate Issuer:</th><th>ATOL number:</th><th><?= e($atol->packageLabel) ?></th></tr></thead><tbody><tr><td><?= e($atol->bookingRef) ?></td><td><?= e($atol->issueDate) ?></td><td><?= e($atol->issuerName) ?></td><td><?= e($atol->atolNumber) ?></td><td></td></tr></tbody></table>
  <p class="vt-atol__copy">Copyright UK Civil Aviation Authority. The ATOL Logo is a registered trade mark.</p>
</article>
<?php if ($atol->parts): ?>
<article class="vt-atol vt-atol--multi">
  <p class="vt-atol__note">This is an important document. Make sure that you take it with you when you travel.</p>
  <h1 class="vt-atol__title">ATOL Certificate</h1>
  <p class="vt-atol__h2">Parts of your trip covered by this certificate</p>
  <table class="vt-atol__parts"><thead><tr><th>Parts of the trip</th><th>Details</th><th>Your provider and booking reference</th></tr></thead><tbody>
    <?php foreach ($atol->parts as $part): ?><tr><td><?= e($part['type']) ?></td><td><?= e($part['details']) ?></td><td><?= e($part['provider']) ?></td></tr><?php endforeach; ?>
    <tr class="vt-atol__total"><td colspan="2">Total ATOL protected cost</td><td><?= e($atol->totalCost) ?></td></tr>
  </tbody></table>
  <table class="vt-atol__tbl"><thead><tr><th>Unique reference number:</th><th>Date of issue:</th><th>ATOL Certificate Issuer:</th><th>ATOL number:</th><th><?= e($atol->packageLabel) ?></th></tr></thead><tbody><tr><td><?= e($atol->bookingRef) ?></td><td><?= e($atol->issueDate) ?></td><td><?= e($atol->issuerName) ?></td><td><?= e($atol->atolNumber) ?></td><td></td></tr></tbody></table>
  <p class="vt-atol__copy">Copyright UK Civil Aviation Authority. The ATOL Logo is a registered trade mark.</p>
</article>
<?php endif; ?>
</body>
</html>
