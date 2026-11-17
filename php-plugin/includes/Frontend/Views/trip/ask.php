<?php
namespace VisionTrips\Frontend;

/** Quick message form. $compact = true renders the quotation version near the top of the page. */
/** @var \VisionTrips\Domain\Trip $trip */
$known = $trip->customerEmail !== '' && (!empty($verified) || $trip->isQuote());
?>
<form class="vt-ask<?= !empty($compact) ? ' vt-ask--compact' : '' ?>" data-ask-form>
  <label class="vt-field"><span><?= !empty($compact) ? 'Questions or changes? Send ' . e($trip->agentName !== '' ? \VisionTrips\Support\Str::firstName($trip->agentName) : 'us') . ' a quick message' : 'Send a quick message about this trip' ?></span><textarea name="message" rows="<?= !empty($compact) ? 2 : 3 ?>" maxlength="2000" placeholder="Ask a question, request a change or tell us what you'd like to add…"></textarea></label>
  <?php if ($known): ?>
    <p class="vt-ask__to" data-ask-known><button type="button" class="vt-link vt-small" data-ask-change>Reply to a different email address?</button></p>
    <label class="vt-field" data-ask-emailfield hidden><span>Reply to</span><input type="email" name="email" autocomplete="email" value="<?= e($trip->customerEmail) ?>"></label>
  <?php else: ?>
    <label class="vt-field"><span>Your email, so we can reply</span><input type="email" name="email" autocomplete="email" value=""></label>
  <?php endif; ?>
  <div class="vt-ask__row"><button type="submit" class="vt-btn vt-btn--primary vt-btn--sm">Send message</button><?php if (!empty($compact)): ?><a class="vt-link vt-small" href="#help">Other ways to reach us</a><?php endif; ?></div>
  <p class="vt-ask__status" role="status" hidden></p>
</form>
