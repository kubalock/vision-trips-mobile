<?php
namespace VisionTrips\Frontend;

use VisionTrips\Integrations\Places;
use VisionTrips\Support\Str;

/** @var array<int,array{dest:array,images:array<int,array{url:string,source:string}>,text:string,country:string,lat:?float,lng:?float,placeId:string}> $cards */
if (!$cards) {
    return;
}
$countrySlug = static fn (string $c) => Str::slug((string) preg_replace('/\(.*?\)|,.*$/', '', $c));
?>
<div class="vt-dests">
<?php foreach ($cards as $card): $d = $card['dest']; $imgs = $card['images']; $slug = $countrySlug($card['country']); ?>
  <article class="vt-dest">
    <?php if ($imgs): ?>
      <div class="vt-gallery vt-gallery--hero" data-gallery>
        <?php foreach ($imgs as $img): ?><a href="<?= e($img['url']) ?>" data-lightbox><img src="<?= e($img['url']) ?>" alt="<?= e($d['name']) ?>" loading="lazy" decoding="async"></a><?php endforeach; ?>
      </div>
    <?php endif; ?>
    <div class="vt-dest__body">
      <h3 class="vt-h3"><?= e($d['name']) ?><?php if ($card['country'] !== '' && strcasecmp($card['country'], $d['name']) !== 0): ?><span class="vt-dest__country"><?= e($card['country']) ?></span><?php endif; ?></h3>
      <?php if ($card['text'] !== ''): ?><div class="vt-dest__overview"><?= raw($card['text']) ?></div><?php elseif (!empty($card['pending'])): ?><p class="vt-stay__pending"><span class="vt-sk__line"></span>Putting together a few words about <?= e($d['name']) ?>…</p><?php endif; ?>
      <?php $sec = $card['sections'] ?? ['attractions' => ['html' => $d['attractions']], 'practical' => ['html' => $d['practical']], 'culture' => ['html' => $d['culture']]]; ?>
      <?php if ($sec['attractions']['html'] !== ''): ?><details class="vt-more"><summary><span>Things to do</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= raw($sec['attractions']['html']) ?></div></details><?php endif; ?>
      <?php if ($sec['practical']['html'] !== ''): ?><details class="vt-more"><summary><span>Practical information</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= raw($sec['practical']['html']) ?></div></details><?php endif; ?>
      <?php if ($sec['culture']['html'] !== ''): ?><details class="vt-more"><summary><span>Culture and local insights</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= raw($sec['culture']['html']) ?></div></details><?php endif; ?>
      <?php if ($card['country'] !== ''): ?>
        <details class="vt-more">
          <summary><span>Official travel advice</span><?= icon('chevron') ?></summary>
          <div class="vt-longtext">
            <p>Entry rules, safety and health advice change, so we point you to the official sources rather than repeating them here:</p>
            <ul class="vt-links">
              <li><a href="<?= e('https://www.gov.uk/foreign-travel-advice/' . $slug) ?>" target="_blank" rel="noopener"><?= icon('external') ?> FCDO travel advice for <?= e($card['country']) ?></a></li>
              <li><a href="https://travelhealthpro.org.uk/countries" target="_blank" rel="noopener"><?= icon('external') ?> TravelHealthPro — vaccinations and health risks</a></li>
              <li><a href="https://www.fitfortravel.nhs.uk/destinations" target="_blank" rel="noopener"><?= icon('external') ?> NHS Fit for Travel</a></li>
              <li><a href="https://www.gov.uk/foreign-travel-advice" target="_blank" rel="noopener"><?= icon('external') ?> Passport, visa and entry requirements (gov.uk)</a></li>
            </ul>
            <p class="vt-small">Ask us if anything is unclear — checking requirements for every traveller is part of the service.</p>
          </div>
        </details>
      <?php endif; ?>
      <details class="vt-map"><summary><?= icon('pin') ?><span>Map</span><?= icon('chevron') ?></summary><iframe title="Map of <?= e($d['name']) ?>" loading="lazy" referrerpolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" data-src="<?= e(Places::embedUrl($d['name'] . ($card['country'] !== '' ? ', ' . $card['country'] : ''), $card['lat'], $card['lng'], $card['placeId'])) ?>"></iframe></details>
    </div>
  </article>
<?php endforeach; ?>
</div>
