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
    <?php if ($step === 'list' || $step === 'prefs'): ?>
      <nav class="vt-segment vt-portal__nav" aria-label="Portal">
        <a href="<?= e($self) ?>" role="tab" aria-selected="<?= $step === 'list' ? 'true' : 'false' ?>">My trips</a>
        <a href="<?= e($self) ?>&view=prefs" role="tab" aria-selected="<?= $step === 'prefs' ? 'true' : 'false' ?>">Preferences</a>
      </nav>
    <?php endif; ?>
    <?php if ($step === 'prefs' && $prefs !== null): ?>
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
</main>
</body>
<script src="<?= e(VISION_TRIPS_URL . 'assets/js/vision.js?ver=' . \VisionTrips\Plugin::assetVersion('assets/js/vision.js')) ?>" defer></script>
</html>
