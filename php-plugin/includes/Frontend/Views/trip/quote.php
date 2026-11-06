<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$deposit = $trip->depositPayment();
if (!empty($traveller) || isset($_COOKIE['vtr_acc_' . substr(md5($trip->base . $trip->id), 0, 12)])) {
    return;
}
$notice = \VisionTrips\Domain\Legal::notice($trip);
$sections = [
    'package'    => ['title' => 'What you are booking', 'html' => '<p>Please check these details carefully. They form the basis of your contract.</p>' . \VisionTrips\Domain\Legal::keyInformationHtml($trip)],
    'names'      => ['title' => 'Check every name', 'html' => '<p>Names must match passports exactly. Tell us straight away if anything needs changing — airlines charge to correct names after ticketing.</p>' . ($trip->travellers ? '<ul>' . implode('', array_map(static fn ($t) => '<li>' . e($t->name) . '</li>', $trip->travellers)) . '</ul>' : '<p>' . e($trip->lead ? $trip->lead->name : '') . '</p>') . ($brand->templates['correct_names'] ?? '')],
    'important'  => ['title' => 'Important information', 'html' => ($brand->templates['important'] ?? '') . ($brand->templates['total_price'] ?? '') . ($brand->templates['flight'] ?? '') . ($brand->templates['insurance'] ?? '') . ($brand->templates['travel_aware'] ?? '') ?: '<p>Your travel agent will confirm the full details of your arrangements before travel.</p>'],
    'protection' => ['title' => 'Who you are booking with and how you are protected', 'html' => partial('trip/protection-text', get_defined_vars()) . ($notice ? '<h4>' . e($notice['title']) . '</h4>' . $notice['html'] : '')],
    'terms'      => ['title' => 'Booking terms and conditions', 'html' => ($brand->templates['terms'] ?? '') . ($brand->templates['ptr'] ?? '') ?: '<p>Our standard booking conditions apply. Ask us for a copy if you have not received one.</p>'],
];
?>
<section class="vt-section vt-accept" id="accept" aria-labelledby="accept-h">
  <div class="vt-accept__card">
    <h2 class="vt-h2" id="accept-h">Ready to go ahead?</h2>
    <p class="vt-accept__lead">Read five short sections, confirm your details and we'll take you straight to the <?= $deposit ? e($deposit->money()) . ' deposit' : 'deposit' ?>. It takes about three minutes.</p>
    <ol class="vt-accept__steps" aria-label="Steps">
      <li>Read &amp; confirm</li><li>Your details</li><li>Pay deposit</li>
    </ol>
    <button type="button" class="vt-btn vt-btn--primary vt-btn--wide" data-open-accept>Start</button>
    <?php if ($trip->quoteExpiry): ?><p class="vt-accept__expiry">This price is held until <?= e(Dates::long($trip->quoteExpiry)) ?>.</p><?php endif; ?>
  </div>

  <div class="vt-modal" id="vt-accept-modal" hidden role="dialog" aria-modal="true" aria-labelledby="accept-modal-h">
    <div class="vt-modal__card" data-accept-form>
      <header class="vt-modal__head">
        <h3 id="accept-modal-h">Accept your quotation</h3>
        <button type="button" class="vt-iconbtn" data-close-accept aria-label="Close"><?= icon('close') ?></button>
      </header>
      <div class="vt-modal__body">
        <p class="vt-modal__intro">Open each section and scroll to the end. The accept button unlocks when all five are read.</p>
        <?php foreach ($sections as $key => $s): ?>
          <details class="vt-read" data-read="<?= e($key) ?>">
            <summary><span class="vt-read__tick" aria-hidden="true"><?= icon('check') ?></span><span><?= e($s['title']) ?></span><?= icon('chevron', 'vt-read__chev') ?></summary>
            <div class="vt-read__body" data-read-scroll><?= raw($s['html']) ?><p class="vt-read__end">End of section.</p></div>
          </details>
        <?php endforeach; ?>
        <div class="vt-accept__fields">
          <label class="vt-field"><span>Your full name</span><input type="text" name="name" autocomplete="name" required value="<?= e($trip->lead ? $trip->lead->name : '') ?>"></label>
          <label class="vt-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required value="<?= e($verified ? $trip->customerEmail : '') ?>"></label>
          <label class="vt-checkbox"><input type="checkbox" name="agreed" required><span>I confirm the names and details are correct and I accept the booking terms on behalf of everyone travelling. I understand <?= e($brand->memberCompany ?: $brand->name) ?> will take the deposit to secure the booking.</span></label>
        </div>
        <p class="vt-accept__error" data-accept-error role="alert" hidden></p>
      </div>
      <footer class="vt-modal__foot">
        <button type="button" class="vt-btn vt-btn--primary vt-btn--wide" data-accept-submit disabled>Accept and pay <?= $deposit ? e($deposit->money()) . ' deposit' : 'deposit' ?></button>
        <p class="vt-modal__small">Secure payment handled by Mint Payments. Your booking is confirmed once the supplier confirms availability.</p>
      </footer>
    </div>
  </div>
</section>
