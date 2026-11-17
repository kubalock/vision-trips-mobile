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
        <?php if ($u['image'] !== ''): ?><img src="<?= e($u['image']) ?>" alt="" loading="lazy" decoding="async" onerror="this.remove()"><?php else: ?><span class="vt-extra__tile" aria-hidden="true"><?= icon('sparkle') ?></span><?php endif; ?>
        <div>
          <strong><?= e($u['name']) ?></strong>
          <?php if ($u['info'] !== ''): ?><div class="vt-extra__text"><?= raw($u['info']) ?></div><?php endif; ?>
          <div class="vt-extra__actions">
            <?php if (!empty($u['link'])): ?><a class="vt-btn vt-btn--primary vt-btn--sm" href="<?= e($u['link']) ?>" target="_blank" rel="noopener sponsored" data-upsell-link="<?= e($u['name']) ?>"><?= icon('external') ?> Book this</a><?php endif; ?>
            <a class="vt-btn vt-btn--ghost vt-btn--sm" href="#help" data-ask data-ask-prefill="I'd like to add <?= e($u['name']) ?> to my booking."><?= icon('sparkle') ?> <?= !empty($u['link']) ? 'Ask us instead' : 'Add this' ?></a>
          </div>
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
