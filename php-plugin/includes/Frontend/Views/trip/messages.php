<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
if (!$trip->messages) {
    return;
}
?>
<section class="vt-section" id="messages" aria-labelledby="messages-h">
  <h2 class="vt-h2" id="messages-h">What we've sent you</h2>
  <p class="vt-section__lead">A record of every email and message from <?= e($brand->name) ?> about this trip, in case one goes astray.</p>
  <ul class="vt-msgs" role="list">
    <?php foreach (array_slice($trip->messages, 0, 12) as $m): ?>
      <li class="vt-msg">
        <?php if ($m['content'] !== ''): ?>
        <details>
          <summary>
            <span class="vt-msg__icon"><?= icon($m['type'] === 'SMS' ? 'phone' : 'mail') ?></span>
            <span class="vt-msg__main"><strong><?= e($m['subject']) ?></strong><em><?= e($m['type']) ?><?= $m['date'] ? ' · sent ' . e(Dates::medium($m['date'])) : '' ?></em></span>
            <span class="vt-msg__sent"><?= icon('check') ?> Sent</span>
            <?= icon('chevron') ?>
          </summary>
          <div class="vt-msg__body vt-longtext"><?= raw($m['content']) ?></div>
        </details>
        <?php else: ?>
        <div class="vt-msg__row">
          <span class="vt-msg__icon"><?= icon($m['type'] === 'SMS' ? 'phone' : 'mail') ?></span>
          <span class="vt-msg__main"><strong><?= e($m['subject']) ?></strong><em><?= e($m['type']) ?><?= $m['date'] ? ' · sent ' . e(Dates::medium($m['date'])) : '' ?></em></span>
          <span class="vt-msg__sent"><?= icon('check') ?> Sent</span>
        </div>
        <?php endif; ?>
      </li>
    <?php endforeach; ?>
  </ul>
  <p class="vt-msgs__foot">Missing one? <a class="vt-link" href="#help" data-ask data-ask-prefill="Could you resend my booking emails? I can't find one of them.">Ask us to resend it</a></p>
</section>
