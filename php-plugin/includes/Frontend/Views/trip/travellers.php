<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/**
 * Who's travelling: names exactly as booked, so a misspelling or a passport problem is seen early rather than at
 * the airport. Dates of birth and passport details only on a verified session (the setting decides for dates of birth).
 */
/** @var \VisionTrips\Domain\Trip $trip */
if (!$trip->travellers) {
    return;
}
$verifiedSession = !empty($verified);
$showDob = $verifiedSession && \VisionTrips\Settings::bool('show_dob');
$showPassport = $verifiedSession;
$lead = $trip->lead;
$mask = static fn (string $v): string => $v === '' ? '' : str_repeat('•', max(0, strlen($v) - 3)) . substr($v, -3);
$returnDate = $trip->returns;
?>
<section class="vt-section" id="travellers" aria-labelledby="travellers-h">
  <h2 class="vt-h2" id="travellers-h">Who's travelling</h2>
  <p class="vt-section__lead">Names must match passports exactly — a quick check now saves a problem at the airport.<?= $trip->isQuote() ? '' : ' If anything is wrong, tell us straight away.' ?></p>
  <ul class="vt-travellers" role="list">
    <?php foreach ($trip->travellers as $t): $warn = $returnDate && $t->passportShort($returnDate, 6); ?>
      <li class="vt-traveller<?= $warn ? ' is-warn' : '' ?>">
        <span class="vt-traveller__avatar" aria-hidden="true"><?= e(mb_strtoupper(mb_substr($t->first ?: $t->name, 0, 1))) ?></span>
        <div class="vt-traveller__body">
          <strong><?= e($t->name) ?><?= $t->isLead ? ' <em>lead passenger</em>' : '' ?><?= $t->isInfant ? ' <em>infant</em>' : '' ?></strong>
          <span class="vt-traveller__meta">
            <?php $bits = []; ?>
            <?php if ($showDob && $t->dob) { $bits[] = 'Born ' . Dates::medium($t->dob); } elseif ($t->age !== null && !$showDob) { $bits[] = 'Age ' . $t->age; } ?>
            <?php if ($t->nationality !== '') { $bits[] = $t->nationality; } ?>
            <?php if ($showPassport && $t->passportNumber !== '') { $bits[] = 'Passport ' . $mask($t->passportNumber); } ?>
            <?php if ($showPassport && $t->passportExpiry) { $bits[] = ($t->passportNumber !== '' ? 'expires ' : 'Passport expires ') . Dates::medium($t->passportExpiry); } elseif ($showPassport && $t->passportNumber === '') { $bits[] = 'No passport on file'; } ?>
            <?php if ($t->meals) { $bits[] = implode(', ', $t->meals); } ?>
            <?php if ($t->ssr) { $bits[] = implode(', ', $t->ssr); } ?>
            <?= e(implode(' · ', $bits)) ?>
          </span>
          <?php if ($warn): ?><span class="vt-traveller__warn"><?= icon('alert') ?> Passport expires within six months of your return — many countries will refuse entry. Please check the entry rules or ask us.</span><?php endif; ?>
        </div>
      </li>
    <?php endforeach; ?>
  </ul>
  <?php if ($verifiedSession && $lead && ($trip->customerEmail !== '' || $trip->customerPhone !== '')): ?>
    <p class="vt-small vt-travellers__contact"><?= icon('user') ?><span>We have <?= e($lead->name) ?> down as the lead passenger<?= $trip->customerPhone !== '' ? ', with a phone number ending ' . e(substr((string) preg_replace('/\D/', '', $trip->customerPhone), -3)) : '' ?>. To change contact details, just ask.</span></p>
  <?php endif; ?>
  <p class="vt-travellers__actions">
    <a class="vt-btn vt-btn--ghost vt-btn--sm" href="<?= $trip->isQuote() ? '#ask-top' : '#help' ?>" data-ask data-ask-prefill="I need to correct a traveller's details: "><?= icon('alert') ?> Spot a mistake? Tell us</a>
    <?php if (!empty($urls['portal'])): ?><a class="vt-btn vt-btn--ghost vt-btn--sm" href="<?= e($urls['portal']) ?>&view=account"><?= icon('lock') ?> Update passports and details</a><?php endif; ?>
  </p>
</section>
