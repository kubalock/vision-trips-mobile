<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
/** @var \VisionTrips\Domain\Brand $brand */
$logo = $brand->logoTransparent !== '' ? $brand->logoTransparent : $brand->logo;
$title = 'Verify to view your trip — ' . $brand->name;
$image = $brand->hero !== '' ? $brand->hero : $trip->heroImage();
$otpMode = in_array('otp', $options, true);
$knowledge = array_values(array_filter($options, static fn ($o) => $o !== 'otp'));
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<?= partial('partials/head', ['title' => $title, 'brand' => $brand, 'accent' => $accent, 'fontsUrl' => $fontsUrl, 'displayFont' => $displayFont, 'bodyFont' => $bodyFont, 'theme' => $theme, 'stylesheet' => 'vision']) ?>
</head>
<body class="vt vt-gatepage <?= e(\VisionTrips\Domain\Theme::bodyClasses($theme)) ?>">
<main class="vt-gate">
  <div class="vt-gate__visual"<?= $image !== '' ? ' style="background-image:url(\'' . e($image) . '\')"' : '' ?>></div>
  <div class="vt-gate__panel">
    <?php if ($logo !== ''): ?><img class="vt-gate__logo" src="<?= e($logo) ?>" alt="<?= e($brand->name) ?>"><?php else: ?><p class="vt-gate__brand"><?= e($brand->name) ?></p><?php endif; ?>
    <h1 class="vt-gate__title">Your trip is waiting</h1>
    <p class="vt-gate__lead">Quick check that it's you, so your booking details stay private. We'll remember this device.</p>
    <?php if ($error !== ''): ?><p class="vt-gate__error" role="alert"><?= icon('alert') ?> <?= e($error) ?></p><?php endif; ?>

    <?php if ($otpSentTo !== ''): ?>
      <form method="post" class="vt-gate__form">
        <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="otp_verify">
        <p>We've emailed a 6-digit code to <strong><?= e($otpSentTo) ?></strong>.</p>
        <label class="vt-field"><span>Enter the code</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus class="vt-field__code"></label>
        <button class="vt-btn vt-btn--primary vt-btn--wide">Open my trip</button>
      </form>
      <form method="post" class="vt-gate__alt"><input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="otp_send"><button class="vt-link">Send a new code</button></form>
    <?php else: ?>
      <?php if ($knowledge): ?>
        <form method="post" class="vt-gate__form" data-gate-form>
          <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="knowledge">
          <?php if (count($knowledge) > 1): ?>
            <div class="vt-segment" role="tablist">
              <?php foreach ($knowledge as $i => $opt): ?><button type="button" role="tab" aria-selected="<?= $i === 0 ? 'true' : 'false' ?>" data-method="<?= e($opt) ?>"><?= e($opt === 'postcode' ? 'Postcode' : ($opt === 'surname' ? 'Surname' : 'Name & date of birth')) ?></button><?php endforeach; ?>
            </div>
          <?php endif; ?>
          <input type="hidden" name="method" value="<?= e($knowledge[0]) ?>">
          <?php foreach ($knowledge as $i => $opt): ?>
            <div class="vt-gate__method" data-method-panel="<?= e($opt) ?>"<?= $i > 0 ? ' hidden' : '' ?>>
              <?php if ($opt === 'postcode'): ?>
                <label class="vt-field"><span>The postcode on your booking</span><input type="text" name="postcode" autocomplete="postal-code" autocapitalize="characters" placeholder="e.g. TR11 3AB" <?= $i === 0 ? 'autofocus' : '' ?>></label>
              <?php elseif ($opt === 'surname'): ?>
                <label class="vt-field"><span>Lead passenger's surname</span><input type="text" name="surname" autocomplete="family-name" <?= $i === 0 ? 'autofocus' : '' ?>></label>
              <?php else: ?>
                <label class="vt-field"><span>Surname of anyone travelling</span><input type="text" name="surname" autocomplete="family-name"></label>
                <label class="vt-field"><span>Their date of birth</span><input type="date" name="dob" autocomplete="bday"></label>
              <?php endif; ?>
            </div>
          <?php endforeach; ?>
          <button class="vt-btn vt-btn--primary vt-btn--wide">Open my trip</button>
        </form>
      <?php endif; ?>
      <?php if ($otpMode): ?>
        <form method="post" class="vt-gate__alt">
          <input type="hidden" name="_vt" value="<?= e($nonce) ?>"><input type="hidden" name="vt_action" value="otp_send">
          <?php if ($knowledge): ?><p class="vt-gate__or">or</p><?php endif; ?>
          <button class="<?= $knowledge ? 'vt-btn vt-btn--ghost vt-btn--wide' : 'vt-btn vt-btn--primary vt-btn--wide' ?>"><?= icon('mail') ?> Email me a code<?= $maskedEmail !== '' ? ' (' . e($maskedEmail) . ')' : '' ?></button>
        </form>
      <?php endif; ?>
      <?php if (!$knowledge && !$otpMode): ?>
        <p>We can't verify this booking online yet. Please contact <?= e($brand->name) ?><?= $brand->phone !== '' ? ' on <a href="' . e(tel($brand->phone)) . '">' . e($brand->phone) . '</a>' : '' ?>.</p>
      <?php endif; ?>
    <?php endif; ?>
    <p class="vt-gate__foot"><?= icon('lock') ?> Booking <?= e($trip->ref) ?> · <?= e($brand->name) ?><?= $brand->phone !== '' ? ' · ' . e($brand->phone) : '' ?></p>
  </div>
</main>
<script>
document.querySelectorAll('[data-gate-form]').forEach(function(f){var tabs=f.querySelectorAll('[data-method]'),panels=f.querySelectorAll('[data-method-panel]'),hidden=f.querySelector('input[name=method]');tabs.forEach(function(t){t.addEventListener('click',function(){tabs.forEach(function(x){x.setAttribute('aria-selected',x===t?'true':'false')});panels.forEach(function(p){p.hidden=p.dataset.methodPanel!==t.dataset.method});hidden.value=t.dataset.method;var i=f.querySelector('[data-method-panel="'+t.dataset.method+'"] input');if(i)i.focus();});});});
</script>
</body>
</html>
