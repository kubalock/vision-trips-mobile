<?php
namespace VisionTrips\Frontend;

/** @var array<int,array{title:string,text:string}> $guide */
?>
<div class="vt-guide">
  <div class="vt-guide__head"><?php if ($logo !== ''): ?><span class="vt-logo vt-logo--sm"><img src="<?= e($logo) ?>" alt="" loading="lazy"></span><?php endif; ?><strong><?= e($title) ?></strong></div>
  <dl class="vt-kv vt-kv--stack">
    <?php foreach ($guide as $g): ?><div><dt><?= e($g['title']) ?></dt><dd><?= e($g['text']) ?></dd></div><?php endforeach; ?>
  </dl>
  <p class="vt-small">General guidance for all passengers. Always follow the airline's current rules and your booking confirmation.</p>
</div>
