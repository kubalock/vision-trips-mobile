<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$hasMessage = $trip->personalMessage !== '';
$hasAbout = $brand->about !== '';
if (!$hasMessage && !$hasAbout) {
    return;
}
$photo = $brand->teamPhoto !== '' ? $brand->teamPhoto : $brand->hero;
?>
<section class="vt-section vt-note" aria-label="A note from <?= e($brand->name) ?>">
  <div class="vt-note__grid<?= $photo !== '' ? ' has-photo' : '' ?>">
    <div class="vt-note__body">
      <p class="vt-note__greeting"><?= e($copy['greeting']) ?>,</p>
      <?php if ($hasMessage && $trip->personalMessageLong): ?>
        <div class="vt-note__message is-long" data-note-long><?= raw($trip->personalMessage) ?></div>
        <button type="button" class="vt-link vt-note__more" data-note-more>Read the full note</button>
      <?php elseif ($hasMessage): ?><div class="vt-note__message"><?= raw($trip->personalMessage) ?></div><?php endif; ?>
      <?php if ($hasAbout && !$hasMessage): ?><div class="vt-note__about"><?= raw($brand->about) ?></div><?php endif; ?>
      <p class="vt-note__sign"><?= e($trip->agentName !== '' ? $trip->agentName : $brand->name) ?><?php if ($trip->agentName !== ''): ?><span><?= e($brand->name) ?></span><?php endif; ?></p>
    </div>
    <?php if ($photo !== ''): ?><figure class="vt-note__photo"><img src="<?= e($photo) ?>" alt="" loading="lazy" decoding="async"></figure><?php endif; ?>
  </div>
</section>
