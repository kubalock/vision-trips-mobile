<?php
namespace VisionTrips\Frontend;

use VisionTrips\Integrations\Places;
use VisionTrips\Support\Dates;

/** @var array<int,array{element:\VisionTrips\Domain\Element,place:?array,description:string}> $cards */
if (!$cards) {
    return;
}
?>
<div class="vt-stays" data-reveal-after="3" data-reveal-noun="stays">
<?php foreach ($cards as $card): $e = $card['element']; $p = $card['place']; $photos = $p['photos'] ?? []; if (!$photos && $e->images) { $photos = array_map(static fn ($i) => ['url' => $i['url'], 'official' => true], $e->images); } ?>
  <article class="vt-stay">
    <?php $shown = array_values(array_filter(array_map(static fn ($ph) => \VisionTrips\Integrations\Places::photoSrc($ph), $photos))); ?>
    <?php if ($shown): ?>
      <div class="vt-gallery vt-gallery--hero" data-gallery>
        <?php foreach ($photos as $i => $ph): $src = \VisionTrips\Integrations\Places::photoSrc($ph); if ($src === '') { continue; } ?><a href="<?= e($src) ?>" data-lightbox<?= $i === 0 ? ' class="is-first"' : '' ?>><img src="<?= e($src) ?>" alt="<?= e($e->title) ?>"<?= $i < 3 ? '' : ' loading="lazy"' ?> decoding="async" onerror="this.parentNode.remove()"></a><?php endforeach; ?>
      </div>
    <?php endif; ?>
    <div class="vt-stay__body">
      <div class="vt-stay__head">
        <div>
          <h3 class="vt-h3"><?= e($p['name'] ?? $e->title) ?></h3>
          <p class="vt-stay__dates"><?= e(Dates::range($e->start, $e->end)) ?><?= $e->nights ? ', ' . e($e->nights) . ' night' . ($e->nights === 1 ? '' : 's') : '' ?><?= $e->rooms ? ' · ' . e(implode('; ', $e->rooms)) : '' ?><?= !empty($card['airport']) ? ' · about ' . e((string) $card['airport']['km']) . ' km from ' . e($card['airport']['name']) . ' airport' : '' ?></p>
        </div>
        <?php if (!empty($p['rating'])): ?><div class="vt-rating" title="Google rating"><?= icon('star') ?><strong><?= e(number_format((float) $p['rating'], 1)) ?></strong><span><?= e(number_format((int) $p['ratings'])) ?> Google reviews</span></div><?php endif; ?>
      </div>
      <?php if (!empty($card['facilities'])): ?><ul class="vt-chips" role="list" aria-label="Facilities"><?php foreach ($card['facilities'] as $fac): ?><li><?= e($fac) ?></li><?php endforeach; ?></ul><?php endif; ?>
      <?php if ($card['description'] !== ''): ?><p class="vt-stay__desc"><?= e($card['description']) ?></p><?php endif; ?>
      <?php if ($p && $p['reviews']): ?>
        <blockquote class="vt-quote"><?= e($p['reviews'][0]['text']) ?><cite>Google review</cite></blockquote>
      <?php endif; ?>
      <div class="vt-stay__links">
        <?php $addr = $p['address'] ?? $e->address; if ($addr !== ''): ?><a class="vt-chip" href="<?= e(Places::directionsUrl(($p['name'] ?? $e->title) . ', ' . $addr, $p['lat'] ?? $e->lat, $p['lng'] ?? $e->lng)) ?>" target="_blank" rel="noopener"><?= icon('pin') ?> Directions</a><?php endif; ?>
        <a class="vt-chip" href="#help" data-ask data-ask-prefill="I have a question about <?= e($p['name'] ?? $e->title) ?>."><?= icon('help') ?> Ask us about this stay</a>
      </div>
      <?php if ($addr !== '' || ($p['lat'] ?? $e->lat) !== null): ?>
        <details class="vt-map">
          <summary><?= icon('pin') ?><span>Map</span><?= icon('chevron') ?></summary>
          <iframe title="Map of <?= e($p['name'] ?? $e->title) ?>" loading="lazy" referrerpolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" data-src="<?= e(Places::embedUrl(($p['name'] ?? $e->title) . ', ' . $addr, $p['lat'] ?? $e->lat, $p['lng'] ?? $e->lng, $p['id'] ?? '')) ?>"></iframe>
        </details>
      <?php endif; ?>
    </div>
  </article>
<?php endforeach; ?>
</div>
