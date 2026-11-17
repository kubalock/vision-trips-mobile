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
<div class="vt-dests" data-reveal-after="3" data-reveal-noun="destinations">
<?php foreach ($cards as $card): $d = $card['dest']; $imgs = $card['images']; $slug = $countrySlug($card['country']); ?>
  <article class="vt-dest">
    <?php if ($imgs): ?>
      <div class="vt-gallery vt-gallery--hero" data-gallery>
        <?php foreach ($imgs as $gi => $img): ?><a href="<?= e($img['url']) ?>" data-lightbox><img src="<?= e($img['url']) ?>" alt="<?= e($d['name']) ?>"<?= $gi < 3 ? '' : ' loading="lazy"' ?> decoding="async" onerror="this.parentNode.remove()"></a><?php endforeach; ?>
      </div>
    <?php endif; ?>
    <div class="vt-dest__body">
      <h3 class="vt-h3"><?= e($d['name']) ?><?php if ($card['country'] !== '' && strcasecmp($card['country'], $d['name']) !== 0): ?><span class="vt-dest__country"><?= e($card['country']) ?></span><?php endif; ?></h3>
      <?php if (!empty($card['facts'])): $labels = ['currency' => 'Currency', 'language' => 'Language', 'time_difference' => 'Time difference', 'flight_time' => 'Flight time', 'plugs' => 'Plugs', 'best_time' => 'Best time to go']; ?>
        <dl class="vt-facts"><?php foreach ($labels as $k => $label): if (!empty($card['facts'][$k])): ?><div><dt><?= e($label) ?></dt><dd><?= e($card['facts'][$k]) ?></dd></div><?php endif; endforeach; ?></dl>
      <?php endif; ?>
      <?php if (!empty($card['climate'])): $cl = $card['climate']; ?>
        <p class="vt-climate"><?= icon('sun') ?><span>In <?= e($cl['month']) ?> it's usually <strong><?= e((string) $cl['high']) ?>°</strong> by day and <strong><?= e((string) $cl['low']) ?>°</strong> at night, with about <?= e((string) $cl['sun']) ?> hours of sunshine a day<?= $cl['rainDays'] > 0 ? ' and ' . e((string) $cl['rainDays']) . ' rainy day' . ($cl['rainDays'] === 1 ? '' : 's') . ' in the month' : ' and hardly any rain' ?>.</span></p>
      <?php endif; ?>
      <?php if ($card['text'] !== ''): ?><div class="vt-dest__overview"><?= raw($card['text']) ?></div><?php endif; ?>
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
