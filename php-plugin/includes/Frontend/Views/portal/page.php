<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Brand $brand */
$logo = $brand->logoTransparent !== '' ? $brand->logoTransparent : $brand->logo;
$title = 'My trips — ' . $brand->name;
$theme = 'default';
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<?= partial('partials/head', ['title' => $title, 'brand' => $brand, 'accent' => $accent, 'fontsUrl' => $fontsUrl, 'displayFont' => $displayFont, 'bodyFont' => $bodyFont, 'theme' => $theme, 'stylesheet' => 'vision']) ?>
</head>
<body class="vt vt-gatepage <?= e(\VisionTrips\Domain\Theme::bodyClasses('default')) ?>">
<main class="vt-gate">
  <div class="vt-gate__visual"<?= $brand->hero !== '' ? ' style="background-image:url(\'' . e($brand->hero) . '\')"' : '' ?>></div>
  <div class="vt-gate__panel">
    <?php if ($logo !== ''): ?><img class="vt-gate__logo" src="<?= e($logo) ?>" alt="<?= e($brand->name) ?>"><?php else: ?><p class="vt-gate__brand"><?= e($brand->name) ?></p><?php endif; ?>
    <?php $inside = in_array($step, ['list', 'prefs', 'loyalty', 'account'], true); ?>
    <?php if ($inside): ?>
      <nav class="vt-segment vt-portal__nav" aria-label="Portal">
        <a href="<?= e($self) ?>" role="tab" aria-selected="<?= $step === 'list' ? 'true' : 'false' ?>">My trips</a>
        <?php if ($brand->loyaltyEnabled): ?><a href="<?= e($self) ?>&view=loyalty" role="tab" aria-selected="<?= $step === 'loyalty' ? 'true' : 'false' ?>">Loyalty</a><?php endif; ?>
        <a href="<?= e($self) ?>&view=account" role="tab" aria-selected="<?= $step === 'account' ? 'true' : 'false' ?>">Details</a>
        <a href="<?= e($self) ?>&view=prefs" role="tab" aria-selected="<?= $step === 'prefs' ? 'true' : 'false' ?>">Preferences</a>
      </nav>
    <?php endif; ?>
    <?php if ($step === 'loyalty' && is_array($loyalty)): ?>
      <h1 class="vt-gate__title"><?= $loyalty['vip'] ? '<span class="vt-vip">' . icon('star') . ' VIP</span> ' : '' ?>Your loyalty points</h1>
      <p class="vt-gate__lead">Every trip you book with <?= e($brand->name) ?> earns points you can put towards the next one.</p>
      <div class="vt-loyalty">
        <div class="vt-loyalty__hero">
          <span class="vt-loyalty__big"><?= e(number_format($loyalty['available'])) ?></span>
          <span class="vt-loyalty__label">points available<?= $loyalty['value'] > 0 ? ' · worth ' . e('£' . number_format($loyalty['value'], 2)) : '' ?></span>
          <?php if ($loyalty['expiry']): ?><span class="vt-loyalty__expiry">Use them by <?= e(Dates::long($loyalty['expiry'])) ?></span><?php endif; ?>
        </div>
        <dl class="vt-loyalty__facts">
          <div><dt>Lifetime points</dt><dd><?= e(number_format($loyalty['lifetime'])) ?></dd></div>
          <div><dt>How to use them</dt><dd>Tell us when you book, or ask on any trip page — we apply them for you.</dd></div>
        </dl>
        <?php if ($loyalty['transactions']): ?>
          <h2 class="vt-h3">Your points history</h2>
          <ul class="vt-loyalty__list" role="list">
            <?php foreach (array_slice($loyalty['transactions'], 0, 30) as $tx): $earn = $tx['points'] >= 0; ?>
              <li class="<?= $earn ? 'is-earn' : 'is-redeem' ?>">
                <span class="vt-loyalty__pts"><?= $earn ? '+' : '' ?><?= e(number_format($tx['points'])) ?></span>
                <span class="vt-loyalty__what"><strong><?= e($tx['type'] ?: ($earn ? 'Earned' : 'Redeemed')) ?><?= $tx['booking'] !== '' ? ' · ' . e($tx['booking']) : '' ?></strong><em><?= $tx['date'] ? e(Dates::medium($tx['date'])) : '' ?><?= $tx['notes'] !== '' ? ' · ' . e($tx['notes']) : '' ?></em></span>
              </li>
            <?php endforeach; ?>
          </ul>
        <?php else: ?>
          <p class="vt-small">Your first points land after your next trip home.</p>
        <?php endif; ?>
      </div>
    <?php elseif ($step === 'account'): ?>
      <h1 class="vt-gate__title">Your details</h1>
      <p class="vt-gate__lead">Keep passports, driving licences, next of kin and loyalty programmes up to date so every booking is right first time. Names, dates of birth and contact details are changed by us — just ask.</p>
      <?php if ($notice !== ''): ?><p class="vt-portal__notice" role="status"><?= icon('check') ?> <?= e($notice) ?></p><?php endif; ?>
      <?php if ($error !== ''): ?><p class="vt-gate__error" role="alert"><?= e($error) ?></p><?php endif; ?>
      <?php if (!$people): ?><p class="vt-small">There are no travellers on your account yet.</p><?php endif; ?>
      <?php foreach ($people as $p): $mask = static fn (string $v): string => $v === '' ? '' : str_repeat('•', max(0, strlen($v) - 3)) . substr($v, -3); ?>
        <details class="vt-person" <?= count($people) === 1 ? 'open' : '' ?>>
          <summary class="vt-person__head"><span class="vt-person__avatar" aria-hidden="true"><?= e(mb_strtoupper(mb_substr($p['name'], 0, 1))) ?></span><span><strong><?= e($p['name']) ?></strong><em><?= $p['passport_expiry'] !== '' ? 'Passport expires ' . e(Dates::medium(Dates::parse($p['passport_expiry']))) : 'No passport on file' ?></em></span><?= icon('chevron', 'vt-person__chev') ?></summary>
          <form method="post" class="vt-person__form">
            <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="person"><input type="hidden" name="email" value="<?= e($email) ?>"><input type="hidden" name="person" value="<?= e($p['id']) ?>">
            <fieldset><legend>Passport</legend>
              <div class="vt-fields">
                <label><span>Passport number</span><input type="text" name="passport_number" value="<?= e($p['passport_number']) ?>" autocomplete="off" inputmode="latin" maxlength="12" placeholder="<?= e($mask($p['passport_number']) ?: 'As printed on the passport') ?>"><?php if (!empty($fieldErrors['passport_number'])): ?><em class="vt-field__err"><?= e($fieldErrors['passport_number']) ?></em><?php endif; ?></label>
                <label><span>Nationality</span><input type="text" name="nationality" value="<?= e($p['nationality']) ?>" maxlength="60"></label>
                <label><span>Issuing country</span><input type="text" name="passport_country" value="<?= e($p['passport_country']) ?>" maxlength="60"></label>
                <label><span>Issue date</span><input type="date" name="passport_issue" value="<?= e($p['passport_issue']) ?>"><?php if (!empty($fieldErrors['passport_issue'])): ?><em class="vt-field__err"><?= e($fieldErrors['passport_issue']) ?></em><?php endif; ?></label>
                <label><span>Expiry date</span><input type="date" name="passport_expiry" value="<?= e($p['passport_expiry']) ?>"><?php if (!empty($fieldErrors['passport_expiry'])): ?><em class="vt-field__err"><?= e($fieldErrors['passport_expiry']) ?></em><?php endif; ?></label>
              </div>
            </fieldset>
            <fieldset><legend>Driving licence</legend>
              <div class="vt-fields">
                <label><span>Licence number</span><input type="text" name="licence_number" value="<?= e($p['licence_number']) ?>" autocomplete="off" maxlength="20"><?php if (!empty($fieldErrors['licence_number'])): ?><em class="vt-field__err"><?= e($fieldErrors['licence_number']) ?></em><?php endif; ?></label>
                <label><span>Expiry date</span><input type="date" name="licence_expiry" value="<?= e($p['licence_expiry']) ?>"></label>
              </div>
            </fieldset>
            <fieldset><legend>Next of kin</legend>
              <div class="vt-fields">
                <label><span>Name</span><input type="text" name="nok_name" value="<?= e($p['nok_name']) ?>" maxlength="60"></label>
                <label><span>Phone</span><input type="tel" name="nok_phone" value="<?= e($p['nok_phone']) ?>" maxlength="20"><?php if (!empty($fieldErrors['nok_phone'])): ?><em class="vt-field__err"><?= e($fieldErrors['nok_phone']) ?></em><?php endif; ?></label>
              </div>
            </fieldset>
            <button class="vt-btn vt-btn--primary" type="submit">Save <?= e(\VisionTrips\Support\Str::firstName($p['name'])) ?>'s details</button>
          </form>
          <div class="vt-person__programmes">
            <h3 class="vt-h3">Loyalty programmes</h3>
            <?php foreach ($p['programmes'] as $pr): ?>
              <form method="post" class="vt-programme">
                <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="programme"><input type="hidden" name="email" value="<?= e($email) ?>"><input type="hidden" name="person" value="<?= e($p['id']) ?>"><input type="hidden" name="kind" value="<?= e($pr['kind']) ?>"><input type="hidden" name="programme" value="<?= e($pr['id']) ?>">
                <span class="vt-programme__name"><?= icon($pr['kind'] === 'cruise' ? 'ship' : 'plane') ?> <?= e($pr['name'] ?: ucfirst($pr['kind'])) ?></span>
                <label><span>Membership number</span><input type="text" name="number" value="<?= e($pr['number']) ?>" maxlength="24"></label>
                <label><span>Tier / status</span><input type="text" name="tier" value="<?= e($pr['tier']) ?>" maxlength="40" placeholder="e.g. Silver"></label>
                <button class="vt-btn vt-btn--ghost vt-btn--sm" type="submit">Update</button>
              </form>
            <?php endforeach; ?>
            <details class="vt-programme-add">
              <summary class="vt-link">+ Add an airline or cruise programme</summary>
              <form method="post" class="vt-programme">
                <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="programme"><input type="hidden" name="email" value="<?= e($email) ?>"><input type="hidden" name="person" value="<?= e($p['id']) ?>">
                <label><span>Type</span><select name="kind" data-kind-switch><option value="airline">Airline</option><option value="cruise">Cruise line</option></select></label>
                <label data-kind="airline"><span>Airline</span><select name="operator"><option value="">Choose…</option><?php foreach ($airlines as $id => $n): ?><option value="<?= e($id) ?>"><?= e($n) ?></option><?php endforeach; ?></select></label>
                <label data-kind="cruise" hidden><span>Cruise line</span><select name="operator_cruise" disabled><option value="">Choose…</option><?php foreach ($cruiseLines as $id => $n): ?><option value="<?= e($id) ?>"><?= e($n) ?></option><?php endforeach; ?></select></label>
                <label><span>Membership number</span><input type="text" name="number" maxlength="24" required></label>
                <label><span>Tier / status</span><input type="text" name="tier" maxlength="40" placeholder="optional"></label>
                <button class="vt-btn vt-btn--primary vt-btn--sm" type="submit">Add</button>
              </form>
            </details>
          </div>
        </details>
      <?php endforeach; ?>
      <p class="vt-small vt-account__contact"><?= icon('lock') ?><span>To change a name, date of birth, phone, email or address, <a class="vt-link" href="mailto:<?= e($brand->email) ?>?subject=<?= e(rawurlencode('Updating my details')) ?>">contact us</a> — it updates every booking you have with us.</span></p>
    <?php elseif ($step === 'prefs' && $prefs !== null): ?>
      <h1 class="vt-gate__title">How we stay in touch</h1>
      <p class="vt-gate__lead">Tell us how you'd like to hear about offers and ideas from <?= e($brand->name) ?>, and what you love. Booking and travel messages always come through regardless.</p>
      <?php if ($notice !== ''): ?><p class="vt-portal__notice" role="status"><?= icon('check') ?> <?= e($notice) ?></p><?php endif; ?>
      <form method="post" class="vt-prefs">
        <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="prefs"><input type="hidden" name="email" value="<?= e($email) ?>">
        <fieldset class="vt-prefs__group">
          <legend>Offers and inspiration</legend>
          <label class="vt-switch"><input type="checkbox" name="mkt_email" value="1"<?= $prefs['email'] ? ' checked' : '' ?>><span class="vt-switch__track" aria-hidden="true"></span><span class="vt-switch__text"><strong>Email</strong><em>Occasional offers, new destinations and early access to deals</em></span></label>
          <label class="vt-switch"><input type="checkbox" name="mkt_sms" value="1"<?= $prefs['sms'] ? ' checked' : '' ?>><span class="vt-switch__track" aria-hidden="true"></span><span class="vt-switch__text"><strong>Text message</strong><em>Short, rare, only when it's genuinely time-sensitive</em></span></label>
          <label class="vt-switch"><input type="checkbox" name="mkt_post" value="1"<?= $prefs['post'] ? ' checked' : '' ?>><span class="vt-switch__track" aria-hidden="true"></span><span class="vt-switch__text"><strong>Post</strong><em>Brochures and the occasional card</em></span></label>
        </fieldset>
        <fieldset class="vt-prefs__group">
          <legend>Your preferred departure airports</legend>
          <p class="vt-small">Pick as many as you like — we'll use them when we send you ideas.</p>
          <div class="vt-picker" data-picker data-placeholder="Type an airport, e.g. Bristol">
            <select multiple name="airports[]" size="8" class="vt-picker__native" aria-label="Preferred departure airports">
              <?php foreach ($airports as $a): ?><option value="<?= e($a) ?>"<?= in_array($a, $prefs['airports'], true) ? ' selected' : '' ?>><?= e((string) preg_replace('/ (International )?Airport$/', '', $a)) ?></option><?php endforeach; ?>
            </select>
          </div>
        </fieldset>
        <fieldset class="vt-prefs__group">
          <legend>When you like to travel</legend>
          <div class="vt-chipset">
            <?php foreach ($months as $mo): ?><label class="vt-chipset__chip"><input type="checkbox" name="months[]" value="<?= e($mo) ?>"<?= in_array($mo, $prefs['months'], true) ? ' checked' : '' ?>><span><?= e(substr($mo, 0, 3)) ?></span></label><?php endforeach; ?>
          </div>
        </fieldset>
        <button class="vt-btn vt-btn--primary vt-btn--wide">Save preferences</button>
        <p class="vt-small">You can change these any time. <?php if ($brand->privacyUrl !== ''): ?><a class="vt-link" href="<?= e($brand->privacyUrl) ?>" target="_blank" rel="noopener">How we use your data</a>.<?php endif; ?></p>
      </form>
    <?php elseif ($step === 'list'): ?>
      <h1 class="vt-gate__title">Your trips</h1>
      <?php if (!$trips): ?><p class="vt-gate__lead">There are no trips to show for that email address yet. If you think that's wrong, give us a call.</p><?php endif; ?>
      <ul class="vt-triplist" role="list">
        <?php foreach ($trips as $t): $stage = $t['stage']; ?>
          <li><a href="<?= e($t['url']) ?>">
            <?php if ($t['image'] !== ''): ?><img src="<?= e($t['image']) ?>" alt="" loading="lazy"><?php else: ?><span class="vt-triplist__ph"><?= icon('compass') ?></span><?php endif; ?>
            <span><strong><?= e($t['name']) ?></strong><em><?= e($t['departs'] !== '' ? Dates::range($t['departs'], $t['returns']) : 'Dates to be confirmed') ?> · <?= e($t['status']) ?></em></span>
            <?= icon('arrow') ?>
          </a></li>
        <?php endforeach; ?>
      </ul>
    <?php elseif ($step === 'code'): ?>
      <h1 class="vt-gate__title">Check your email</h1>
      <p class="vt-gate__lead">If <strong><?= e($email) ?></strong> is on a booking with us, we've sent a 6-digit code. It expires in 10 minutes.</p>
      <?php if ($error !== ''): ?><p class="vt-gate__error" role="alert"><?= e($error) ?></p><?php endif; ?>
      <form method="post" class="vt-gate__form">
        <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="verify"><input type="hidden" name="email" value="<?= e($email) ?>">
        <label class="vt-field"><span>Code</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus class="vt-field__code"></label>
        <button class="vt-btn vt-btn--primary vt-btn--wide">Show my trips</button>
      </form>
    <?php else: ?>
      <h1 class="vt-gate__title">All your trips, one place</h1>
      <p class="vt-gate__lead">Enter the email address you booked with and we'll send you a code.</p>
      <?php if ($error !== ''): ?><p class="vt-gate__error" role="alert"><?= e($error) ?></p><?php endif; ?>
      <form method="post" class="vt-gate__form">
        <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="send">
        <label class="vt-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required autofocus value="<?= e($email) ?>"></label>
        <button class="vt-btn vt-btn--primary vt-btn--wide">Email me a code</button>
      </form>
    <?php endif; ?>
    <p class="vt-gate__foot"><?= icon('lock') ?> <?= e($brand->name) ?><?= $brand->phone !== '' ? ' · ' . e($brand->phone) : '' ?><?php if ($step === 'list' || $step === 'prefs'): ?> · <a href="<?= e($self) ?>&signout=1">Sign out</a><?php endif; ?></p>
  </div>
  <p class="vt-powered">Powered by <a href="https://thetravelnetworkgroup.co.uk" rel="noopener" target="_blank">Vision</a> from The Travel Network Group</p>
</main>
</body>
<script src="<?= e(VISION_TRIPS_URL . 'assets/js/vision.js?ver=' . \VisionTrips\Plugin::assetVersion('assets/js/vision.js')) ?>" defer></script>
</html>
