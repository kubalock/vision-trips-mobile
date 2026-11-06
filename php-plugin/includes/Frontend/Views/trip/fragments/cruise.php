<?php
namespace VisionTrips\Frontend;

/** @var array<int,array{element:\VisionTrips\Domain\Element,ship:?array,holiday:?array}> $cards */
if (!$cards) {
    return;
}
?>
<div class="vt-cruises">
<?php $singleCountry = count($trip->countries) === 1 ? strtolower($trip->countries[0]) : ''; ?>
<?php foreach ($cards as $card): $e = $card['element']; $ship = $card['ship']; $holiday = $card['holiday']; $cover = $ship['cover'] ?? $e->shipCover; $days = $holiday['days'] ?? array_map(static fn ($p) => ['day' => $p['day'], 'port' => $p['port'], 'arrive' => $p['arrive'], 'depart' => $p['depart'], 'atSea' => $p['atSea'], 'text' => '', 'image' => '', 'country' => '', 'date' => ''], $e->ports); ?>
  <article class="vt-cruise">
    <?php if ($cover !== ''): ?>
      <div class="vt-cruise__hero" style="--vt-cover:url('<?= e($cover) ?>')">
        <?php if (!empty($ship['profile'])): ?><img class="vt-cruise__logo" src="<?= e($ship['profile']) ?>" alt="" loading="lazy"><?php endif; ?>
        <h3 class="vt-cruise__name"><?= e($ship['name'] ?? $e->ship ?: $e->title) ?></h3>
        <?php if (!empty($ship['operator']) || $e->cruiseLine !== ''): ?><p class="vt-cruise__op"><?= e($ship['operator'] ?? $e->cruiseLine) ?></p><?php endif; ?>
      </div>
    <?php else: ?>
      <h3 class="vt-h3"><?= e($ship['name'] ?? $e->ship ?: $e->title) ?></h3>
    <?php endif; ?>
    <div class="vt-cruise__body">
      <?php if (!empty($ship['teaser'])): ?><div class="vt-cruise__teaser vt-longtext"><?= raw(str_contains((string) $ship['teaser'], '<') ? (string) $ship['teaser'] : \VisionTrips\Support\Str::richText((string) $ship['teaser'])) ?></div><?php endif; ?>
      <?php if (!empty($holiday['description'])): ?><div class="vt-longtext"><?= raw($holiday['description']) ?></div><?php endif; ?>
      <?php if ($days): ?>
        <h4 class="vt-h4">Your voyage<?= $e->voyageCode !== '' && $holiday ? ' · ' . e($e->voyageCode) : '' ?></h4>
        <ol class="vt-voyage" role="list">
          <?php foreach ($days as $d): ?>
            <li class="vt-voyage__day<?= $d['atSea'] ? ' is-sea' : '' ?>">
              <span class="vt-voyage__n">Day <?= e($d['day']) ?></span>
              <div class="vt-voyage__main">
                <strong><?= e($d['port']) ?></strong><?php if (!empty($d['country']) && strtolower($d['country']) !== $singleCountry): ?><span class="vt-voyage__country"><?= e($d['country']) ?></span><?php endif; ?>
                <?php $t = trim(($d['arrive'] !== '' ? 'Arrive ' . $d['arrive'] : '') . ($d['depart'] !== '' ? ' · Depart ' . $d['depart'] : ''), ' ·'); if ($t !== ''): ?><span class="vt-voyage__times"><?= e($t) ?></span><?php endif; ?>
                <?php if (!empty($d['text'])): ?><div class="vt-voyage__text"><?= raw($d['text']) ?></div><?php endif; ?>
              </div>
              <?php if (!empty($d['image'])): ?><img class="vt-voyage__img" src="<?= e($d['image']) ?>" alt="" loading="lazy"><?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ol>
      <?php endif; ?>
      <?php if ($ship && !empty($ship['facts'])): ?>
        <dl class="vt-facts"><?php foreach ($ship['facts'] as $k => $v): ?><div><dt><?= e($k) ?></dt><dd><?= e($v) ?></dd></div><?php endforeach; ?></dl>
      <?php endif; ?>
      <?php if ($ship && !empty($ship['intro'])): ?><details class="vt-more"><summary><span>About the ship</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= raw($ship['intro']) ?></div></details><?php endif; ?>
      <?php if ($ship): foreach ($ship['sections'] as $title => $items): if (!$items) { continue; } ?>
        <details class="vt-more">
          <summary><span><?= e($title) ?></span><span class="vt-more__count"><?= e(count($items)) ?></span><?= icon('chevron') ?></summary>
          <div class="vt-shipsec">
            <?php foreach ($items as $it): ?>
              <div class="vt-shipsec__item">
                <?php if ($it['images']): ?><div class="vt-gallery" data-gallery><?php foreach (array_slice($it['images'], 0, 6) as $img): ?><a href="<?= e($img) ?>" data-lightbox><img src="<?= e($img) ?>" alt="<?= e($it['name']) ?>" loading="lazy"></a><?php endforeach; ?></div><?php endif; ?>
                <strong><?= e($it['name']) ?></strong>
                <?php if ($it['text'] !== ''): ?><div class="vt-longtext"><?= raw($it['text']) ?></div><?php endif; ?>
              </div>
            <?php endforeach; ?>
          </div>
        </details>
      <?php endforeach; endif; ?>
      <?php if (!$ship && !$holiday && $e->voyageCode === '' && !$e->ports): ?><p class="vt-empty">Ship and itinerary details will appear here once added.</p><?php endif; ?>
    </div>
  </article>
<?php endforeach; ?>
</div>
