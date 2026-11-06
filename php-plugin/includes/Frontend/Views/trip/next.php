<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$steps = $trip->nextSteps();
?>
<section class="vt-section" id="next" aria-labelledby="next-h">
  <h2 class="vt-h2" id="next-h">What happens next</h2>
  <p class="vt-section__lead">So you always know when you'll hear from us.</p>
  <ol class="vt-steps" role="list">
    <?php foreach ($steps as $s): ?>
      <li class="vt-step<?= $s['done'] ? ' is-done' : '' ?>">
        <span class="vt-step__dot" aria-hidden="true"><?= $s['done'] ? icon('check') : '' ?></span>
        <div class="vt-step__body">
          <div class="vt-step__head"><strong><?= e($s['title']) ?></strong><?php if ($s['when'] !== '' && !$s['done']): ?><span class="vt-step__when"><?= e($s['when']) ?></span><?php endif; ?></div>
          <span><?= e($s['text']) ?></span>
        </div>
      </li>
    <?php endforeach; ?>
  </ol>
</section>
