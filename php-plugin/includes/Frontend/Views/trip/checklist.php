<?php
namespace VisionTrips\Frontend;

/** @var array<int,array{key:string,title:string,text:string,done:bool,level:string}> $checklist */
$fcdo = '';
if ($trip->countries) {
    $fcdo = 'https://www.gov.uk/foreign-travel-advice/' . \VisionTrips\Support\Str::slug((string) preg_replace('/,.*$/', '', $trip->countries[0]));
}
?>
<section class="vt-section" id="checklist" aria-labelledby="checklist-h">
  <h2 class="vt-h2" id="checklist-h">Before you go</h2>
  <ul class="vt-check" role="list">
    <?php foreach ($checklist as $item): ?>
      <li class="vt-check__item is-<?= e($item['level']) ?>" data-check="<?= e($item['key']) ?>">
        <button type="button" class="vt-check__tick" aria-pressed="<?= $item['done'] ? 'true' : 'false' ?>" aria-label="Mark as done"><?= icon($item['level'] === 'alert' ? 'alert' : 'check') ?></button>
        <div>
          <strong><?= e($item['title']) ?></strong>
          <span><?= e($item['text']) ?><?php if ($item['key'] === 'fcdo' && $fcdo !== ''): ?> <a class="vt-link" href="<?= e($fcdo) ?>" target="_blank" rel="noopener">gov.uk advice</a><?php endif; ?></span>
        </div>
      </li>
    <?php endforeach; ?>
  </ul>
</section>
