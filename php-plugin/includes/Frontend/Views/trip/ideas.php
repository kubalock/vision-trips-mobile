<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$ideas = $ideasOn ? $trip->ideas() : [];
if (!$ideas && !$trip->upsells) {
    return;
}
$title = $trip->isQuote() ? 'Make it yours' : 'Make it even better';
?>
<section class="vt-section" id="extras" aria-labelledby="extras-h">
  <h2 class="vt-h2" id="extras-h"><?= e($title) ?></h2>
  <p class="vt-section__lead">Everything here is arranged by <?= e($brand->name) ?>, protected in the same way as the rest of your trip. One message and we'll price it for you.</p>
  <ul class="vt-extras" role="list">
    <?php foreach ($trip->upsells as $u): ?>
      <li class="vt-extra<?= $u['image'] === '' ? ' no-image' : '' ?>">
        <?php if ($u['image'] !== ''): ?><img src="<?= e($u['image']) ?>" alt="" loading="lazy" decoding="async"><?php endif; ?>
        <div>
          <strong><?= e($u['name']) ?></strong>
          <?php if ($u['info'] !== ''): ?><div class="vt-extra__text"><?= raw($u['info']) ?></div><?php endif; ?>
          <a class="vt-btn vt-btn--ghost vt-btn--sm" href="#help" data-ask data-ask-prefill="I'd like to add <?= e($u['name']) ?> to my booking."><?= icon('sparkle') ?> Add this</a>
        </div>
      </li>
    <?php endforeach; ?>
    <?php foreach ($ideas as $i): ?>
      <li class="vt-extra no-image vt-extra--idea">
        <div>
          <strong><?= e($i['title']) ?></strong>
          <div class="vt-extra__text"><?= e($i['text']) ?></div>
          <a class="vt-btn vt-btn--ghost vt-btn--sm" href="#help" data-ask data-ask-prefill="<?= e($i['ask']) ?>"><?= icon('sparkle') ?> Ask us</a>
        </div>
      </li>
    <?php endforeach; ?>
  </ul>
</section>
