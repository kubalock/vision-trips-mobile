<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$review = $brand->googleReviews !== '' ? $brand->googleReviews : $brand->trustpilot;
$photos = [];
foreach ($trip->activeElements() as $e) {
    foreach ($e->images as $img) {
        $photos[] = $img;
    }
}
foreach ($trip->destinations as $d) {
    if ($d['image'] !== '') {
        $photos[] = ['url' => $d['image'], 'thumb' => $d['image'], 'name' => $d['name']];
    }
}
?>
<section class="vt-section vt-home" id="welcome" aria-labelledby="home-h">
  <h2 class="vt-h2" id="home-h">Thank you for travelling with us</h2>
  <div class="vt-home__grid">
    <?php if ($review !== ''): ?>
      <a class="vt-home__card" href="<?= e($review) ?>" target="_blank" rel="noopener">
        <?= icon('star') ?><strong>Leave a review</strong><span>A minute of your time means a lot to a small business like ours.</span>
      </a>
    <?php endif; ?>
    <a class="vt-home__card" href="#help" data-ask data-ask-prefill="We've just got back and we're already thinking about the next one. Could you send us some ideas?">
      <?= icon('compass') ?><strong>Plan the next one</strong><span>Tell us where you're dreaming of and we'll do the rest.</span>
    </a>
    <button type="button" class="vt-home__card" data-refer data-refer-text="<?= e('We booked our trip with ' . $brand->name . ' and they looked after everything. Worth a call: ' . ($brand->phone !== '' ? $brand->phone : $brand->webDomain) . ($brand->webUrl() !== '' ? ' ' . $brand->webUrl() : '')) ?>">
      <?= icon('share') ?><strong>Recommend us</strong><span>Know someone planning a trip? Send them our details in one tap.</span>
    </button>
    <?php if ($brand->reasons): ?>
      <div class="vt-home__card vt-home__card--static">
        <?= icon('heart') ?><strong><?= e($brand->reasons[0]['title']) ?></strong><span><?= e(\VisionTrips\Support\Str::truncate(strip_tags($brand->reasons[0]['text']), 140)) ?></span>
      </div>
    <?php endif; ?>
  </div>
  <div class="vt-chips" aria-label="Next trip ideas">
    <?php foreach (['Winter sun', 'City break', 'A cruise', 'Big celebration', 'Family holiday', 'Somewhere new'] as $chip): ?><a class="vt-chip" href="#help" data-ask data-ask-prefill="<?= e('Next time we fancy: ' . strtolower($chip) . '. Could you send us some ideas and rough prices?') ?>"><?= icon('sparkle') ?> <?= e($chip) ?></a><?php endforeach; ?>
  </div>
  <?php if ($photos): ?>
    <div class="vt-gallery vt-gallery--memories" data-gallery>
      <?php foreach (array_slice($photos, 0, 10) as $img): ?><a href="<?= e($img['url']) ?>" data-lightbox><img src="<?= e($img['thumb']) ?>" alt="<?= e($img['name']) ?>" loading="lazy" decoding="async"></a><?php endforeach; ?>
    </div>
  <?php endif; ?>
</section>
