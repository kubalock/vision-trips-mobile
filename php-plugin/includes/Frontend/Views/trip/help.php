<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$ooh = $brand->emergencyPhone !== '' ? $brand->emergencyPhone : $trip->emergencyPhone;
$oohLink = $trip->oohLink !== '' ? $trip->oohLink : $brand->oohLink;
$oohEmail = $trip->oohEmail !== '' ? $trip->oohEmail : $brand->oohEmail;
$wa = '';
if ($brand->phone !== '' && preg_match('/^(\+44|0)7/', preg_replace('/\s+/', '', $brand->phone) ?? '')) {
    $wa = 'https://wa.me/' . preg_replace('/^0/', '44', preg_replace('/[^\d]/', '', $brand->phone) ?? '');
}
?>
<?php if (!empty($traveller)): ?><p class="vt-shared-note"><?= icon('user') ?> Shared with you by <?= e($trip->leadFirstName() ?: 'the lead traveller') ?>. Payments and personal details stay with them.</p><?php endif; ?>
<?php if (empty($traveller) && \VisionTrips\Settings::module('share') && count($trip->travellers) > 1 && $level > 0): ?>
<section class="vt-section" id="share" aria-labelledby="share-h">
  <h2 class="vt-h2" id="share-h">Travelling with others?</h2>
  <p class="vt-section__lead">Send your fellow travellers their own link: the itinerary, documents and how to reach us, without your payments or personal details.</p>
  <button type="button" class="vt-btn vt-btn--ghost" data-share-trip><?= icon('share') ?> Share the itinerary</button>
  <p class="vt-small" data-share-status hidden></p>
</section>
<?php endif; ?>
<section class="vt-section" id="help" aria-labelledby="help-h">
  <h2 class="vt-h2" id="help-h">Talk to <?= e($brand->name) ?></h2>
  <div class="vt-help">
    <?php if ($trip->agentName !== ''): ?>
    <div class="vt-agent">
      <span class="vt-agent__avatar" aria-hidden="true"><?= e(mb_strtoupper(mb_substr($trip->agentName, 0, 1))) ?></span>
      <div class="vt-agent__body">
        <strong><?= e($trip->agentName) ?></strong>
        <span>Your travel expert at <?= e($brand->name) ?></span>
        <span class="vt-agent__links"><?php if ($brand->phone !== ''): ?><a href="<?= e(tel($brand->phone)) ?>"><?= e($brand->phone) ?></a><?php endif; ?><?php if ($trip->agentEmail !== ''): ?><a href="mailto:<?= e($trip->agentEmail) ?>?subject=<?= e(rawurlencode($trip->ref . ' – ' . $trip->name)) ?>"><?= e($trip->agentEmail) ?></a><?php endif; ?></span>
      </div>
      <a class="vt-btn vt-btn--primary vt-btn--sm" href="<?= $trip->isQuote() ? '#ask-top' : '#help' ?>" data-ask>Message <?= e(\VisionTrips\Support\Str::firstName($trip->agentName)) ?></a>
    </div>
    <?php endif; ?>
    <div class="vt-help__actions">
      <?php if ($brand->phone !== ''): ?><a class="vt-btn vt-btn--ghost" href="<?= e(tel($brand->phone)) ?>"><?= icon('phone') ?> <?= e($brand->phone) ?></a><?php endif; ?>
      <?php if ($brand->email !== ''): ?><a class="vt-btn vt-btn--ghost" href="mailto:<?= e($brand->email) ?>?subject=<?= e(rawurlencode($trip->ref . ' – ' . $trip->name)) ?>"><?= icon('mail') ?> Email us</a><?php endif; ?>
      <?php if ($wa !== ''): ?><a class="vt-btn vt-btn--ghost" href="<?= e($wa) ?>" target="_blank" rel="noopener"><?= icon('whatsapp') ?> WhatsApp</a><?php endif; ?>
      <?php if ($brand->email !== '' && empty($traveller)): ?><button type="button" class="vt-btn vt-btn--ghost" data-callback-open><?= icon('phone') ?> Call me back</button><?php endif; ?>
    </div>
    <?php if ($brand->email !== '' && empty($traveller)): ?>
    <form class="vt-callback" data-callback hidden>
      <p class="vt-callback__lead">When suits you? We'll call <?= $trip->customerPhone !== '' ? 'the number ending ' . e(substr((string) preg_replace('/\D/', '', $trip->customerPhone), -3)) : 'you' ?>.</p>
      <div class="vt-callback__row">
        <label class="vt-field"><span>Best time</span><select name="slot"><option>As soon as possible</option><option>This morning</option><option>This afternoon</option><option>Tomorrow morning</option><option>Tomorrow afternoon</option><option>Later this week</option></select></label>
        <?php if ($trip->customerPhone === ''): ?><label class="vt-field"><span>Your number</span><input type="tel" name="phone" autocomplete="tel" required></label><?php endif; ?>
        <label class="vt-field"><span>About (optional)</span><input type="text" name="topic" maxlength="120" placeholder="e.g. the room, dates, adding insurance"></label>
      </div>
      <div class="vt-ask__row"><button type="submit" class="vt-btn vt-btn--primary vt-btn--sm">Request a call</button><button type="button" class="vt-link vt-small" data-callback-close>Cancel</button></div>
      <p class="vt-ask__status" role="status" hidden></p>
    </form>
    <?php endif; ?>
    <?php if ($brand->email !== '' && \VisionTrips\Settings::module('message')): ?><?= partial('trip/ask', get_defined_vars() + ['compact' => false]) ?><?php endif; ?>
    <?php if ($ooh !== '' || $oohLink !== '' || $oohEmail !== ''): ?>
      <div class="vt-help__ooh">
        <strong>Out of hours, while you're travelling</strong>
        <span><?php if ($ooh !== ''): ?><a href="<?= e(tel($ooh)) ?>"><?= e($ooh) ?></a><?php endif; ?><?php if ($oohEmail !== ''): ?><?= $ooh !== '' ? ' · ' : '' ?><a href="mailto:<?= e($oohEmail) ?>"><?= e($oohEmail) ?></a><?php endif; ?><?php if ($oohLink !== ''): ?><?= ($ooh !== '' || $oohEmail !== '') ? ' · ' : '' ?><a href="<?= e($oohLink) ?>" target="_blank" rel="noopener">Support page</a><?php endif; ?></span>
      </div>
    <?php endif; ?>
    <?php if ($brand->hasPhysicalAddress && $brand->addressLines): ?>
      <div class="vt-help__visit">
        <div><strong>Visit us</strong><span><?= e(implode(', ', $brand->addressLines)) ?></span><?php if ($brand->mapsLink !== ''): ?> <a class="vt-link" href="<?= e($brand->mapsLink) ?>" target="_blank" rel="noopener">Map</a><?php endif; ?></div>
        <?php if ($brand->hours !== ''): ?><div><strong>Opening hours</strong><div class="vt-help__hours"><?= raw($brand->hours) ?></div></div><?php endif; ?>
      </div>
    <?php endif; ?>
  </div>
</section>
