<?php
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Theme;

/** @var \VisionTrips\Domain\Trip $trip */
/** @var \VisionTrips\Domain\Brand $brand */
$stage = $trip->stage;
$title = $trip->name . ' — ' . $brand->name;
$logo = $brand->logoTransparent !== '' ? $brand->logoTransparent : $brand->logo;
$statusClass = match (true) {
    $trip->isQuote() => 'quote',
    $stage === Stage::CANCELLED => 'cancelled',
    $stage === Stage::CLOSED => 'closed',
    default => 'confirmed',
};
$statusLabel = match ($stage) {
    Stage::QUOTE => 'Quotation', Stage::QUOTE_EXPIRED => 'Quote expired', Stage::CLOSED => 'Closed', Stage::CANCELLED => 'Cancelled', default => 'Confirmed',
};
$away = Stage::isAway($stage);
$home = in_array($stage, [Stage::HOME, Stage::PAST], true);
$mod = static fn (string $k): bool => \VisionTrips\Settings::module($k);
$traveller = !empty($traveller);
if ($traveller) {
    $quoteAccept = false;
}
$folds = $mod('folds');
/** Long-tail sections fold on phones: a tappable heading that opens the section in place (open on desktop via JS). */
$fold = static function (string $id, string $title, string $html) use ($folds): string {
    if (trim($html) === '') {
        return '';
    }
    if (!$folds) {
        return $html;
    }
    $inner = (string) preg_replace('/<h2 class="vt-h2"[^>]*>.*?<\/h2>/s', '', $html, 1);
    $inner = (string) preg_replace('/(<section[^>]*?)\sid="[^"]*"/', '$1', $inner, 1);
    return '<details class="vt-fold" id="' . e($id) . '" data-fold><summary class="vt-fold__head"><span class="vt-h2">' . e($title) . '</span>' . icon('chevron') . '</summary><div class="vt-fold__body">' . $inner . '</div></details>';
};
$ended = in_array($stage, [Stage::CLOSED, Stage::CANCELLED, Stage::QUOTE_EXPIRED], true);
$surprise = $trip->surprise && $trip->isLive();
$config = [
    'rest'   => $urls['rest'],
    'token'  => $token,
    'nonce'  => $nonce,
    'async'  => $async,
    'stage'  => $stage,
    'departs' => $trip->departs ? $trip->departs->format('Y-m-d') . 'T' . ($trip->ofKind('flight')[0]->startTime ?? '00:00') . ':00' : '',
    'ref'    => $trip->ref,
    'name'   => $trip->name,
    'sw'     => (!$preview && \VisionTrips\Settings::bool('sw_enabled')) ? home_url('/' . trim((string) \VisionTrips\Settings::get('trip_page_slug', 'trip'), '/') . '/sw.js') : '',
    'admin'  => (bool) $isWpAdmin,
    'events' => \VisionTrips\Settings::module('events') && !$preview,
    'stage'  => $trip->stage,
    'swScope' => '/' . trim((string) \VisionTrips\Settings::get('trip_page_slug', 'trip'), '/') . '/',
];
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<?= partial('partials/head', ['title' => $title, 'brand' => $brand, 'accent' => $accent, 'fontsUrl' => $fontsUrl, 'displayFont' => $displayFont, 'bodyFont' => $bodyFont, 'theme' => $theme, 'preview' => $preview, 'stylesheet' => 'vision']) ?>
</head>
<body class="vt <?= e(Theme::bodyClasses($theme)) ?> stage-<?= e($stage) ?> tone-<?= e($brand->tone) ?><?= $surprise ? ' is-surprise' : '' ?>" data-stage="<?= e($stage) ?>">
<a class="vt-skip" href="#main">Skip to content</a>

<header class="vt-top" id="top">
  <div class="vt-wrap vt-top__inner">
    <a class="vt-top__brand" href="<?= e($urls['self']) ?>" aria-label="<?= e($brand->name) ?>">
      <?php if ($logo !== ''): ?><img src="<?= e($logo) ?>" alt="<?= e($brand->name) ?>" class="vt-top__logo" decoding="async"><?php else: ?><span class="vt-top__name"><?= e($brand->name) ?></span><?php endif; ?>
    </a>
    <div class="vt-top__meta">
      <span class="vt-ref"><?= e($trip->ref) ?></span>
      <span class="vt-status vt-status--<?= e($statusClass) ?>"><?= e($statusLabel) ?></span>
    </div>
    <div class="vt-top__actions">
      <button type="button" class="vt-iconbtn" data-share title="Share this page" aria-label="Share"><?= icon('share') ?></button>
      <?php if (!$trip->isQuote() || $isAgent): ?><a class="vt-iconbtn" href="<?= e($urls['confirmation']) ?>" title="Print or save as PDF" aria-label="Print"><?= icon('print') ?></a><?php endif; ?>
    </div>
  </div>
</header>

<main id="main" class="vt-main">
  <div class="vt-wrap">
    <?= partial('trip/hero', get_defined_vars()) ?>
    <?php if (!empty($stale)): ?><p class="vt-stale" role="status" data-stale>Showing your trip as last saved — we'll refresh it automatically in a moment.</p><?php endif; ?>
    <?php if (!$ended && $mod('reassure')): ?><?= partial('trip/reassure', get_defined_vars()) ?><?php endif; ?>
    <?php if ($mod('summary') && !$ended): ?><?= partial('trip/summary', get_defined_vars()) ?><?php endif; ?>

    <?php if ($away && !$surprise): ?>
      <?= partial('trip/today', get_defined_vars()) ?>
    <?php endif; ?>

    <?php if ($home && !$surprise): ?>
      <?= partial('trip/home', get_defined_vars()) ?>
    <?php endif; ?>

    <?php if ($trip->stage === Stage::QUOTE && $quoteAccept): ?>
      <?= partial('trip/quote', get_defined_vars()) ?>
    <?php endif; ?>

    <?= partial('trip/message', get_defined_vars()) ?>
    <?php if ($trip->stage === Stage::QUOTE && !$traveller && $mod('compare')): ?><?= partial('trip/compare', get_defined_vars()) ?><?php endif; ?>
    <?php if ($trip->stage === Stage::QUOTE && $mod('whybook')): ?><?= $fold('why', 'Why book with ' . $brand->name, partial('trip/whybook', get_defined_vars())) ?><?php endif; ?>
    <?php if ($trip->isLive() && !$home && !$ended && !$surprise && $mod('next')): ?><?= partial('trip/next', get_defined_vars()) ?><?php endif; ?>
    <?php if (!$ended && !$traveller && $mod('messages')): ?><?= $fold('messages', 'What we\'ve sent you', partial('trip/messages', get_defined_vars())) ?><?php endif; ?>

    <?php if ($ended): ?>
      <?= partial('trip/help', get_defined_vars()) ?>
      <?php if ($stage === Stage::CANCELLED): ?>
        <?= partial('trip/payments', get_defined_vars()) ?>
        <?= partial('trip/documents', get_defined_vars()) ?>
      <?php endif; ?>
    <?php else: ?>
      <?php if ($stage === Stage::PREP && !$surprise): ?>
        <?= partial('trip/checklist', get_defined_vars()) ?>
      <?php endif; ?>
      <?php if (!$surprise): ?>
        <?= View::reveal(partial('trip/itinerary', get_defined_vars()), 'rows') ?>
        <?php if ($trip->hasKind('stay') && $mod('stays')): ?>
          <section class="vt-section" id="stays" aria-labelledby="stays-h">
            <h2 class="vt-h2" id="stays-h">Where you're staying</h2>
            <?php $vm = get_defined_vars(); ?>
            <?= View::external('stays', $preview, fn () => \VisionTrips\Rest\Api::staysFragment($trip, $vm), 'card') ?>
          </section>
        <?php endif; ?>
        <?php if ($trip->hasKind('cruise') && $mod('cruise')): ?>
          <section class="vt-section" id="cruise" aria-labelledby="cruise-h">
            <h2 class="vt-h2" id="cruise-h">Your ship and voyage</h2>
            <?php $vm = get_defined_vars(); ?>
            <?= View::external('cruise', $preview, fn () => \VisionTrips\Rest\Api::cruiseFragment($trip, $vm), 'card') ?>
          </section>
        <?php endif; ?>
        <?= partial('trip/destinations', get_defined_vars()) ?>
      <?php endif; ?>
      <?php if (!$traveller): ?><?= View::reveal(partial('trip/payments', get_defined_vars()), 'card') ?><?php endif; ?>
      <?php if (!$trip->isQuote() || $trip->firstPaymentDate() !== null): ?>
        <?= View::reveal(partial('trip/documents', get_defined_vars()), 'rows') ?>
      <?php endif; ?>
      <?php if ($mod('ideas')): ?><?= $fold('extras', $trip->isQuote() ? 'Make it yours' : 'Make it even better', partial('trip/ideas', get_defined_vars())) ?><?php endif; ?>
      <?php if (!$trip->isQuote() && $mod('whybook')): ?><?= $fold('why', 'Why book with ' . $brand->name, partial('trip/whybook', get_defined_vars())) ?><?php endif; ?>
      <?php if ($mod('faq')): ?><?= $fold('answers', 'Quick answers', partial('trip/faq', get_defined_vars())) ?><?php endif; ?>
      <?= $fold('protection', 'Who you\'re booking with', partial('trip/protection', get_defined_vars())) ?>
      <?= partial('trip/help', get_defined_vars()) ?>
    <?php endif; ?>
    <?php if ($isWpAdmin): ?><?= partial('trip/sources', get_defined_vars()) ?><?php endif; ?>
  </div>
</main>

<?= partial('trip/footer', get_defined_vars()) ?>
<?= partial('trip/nav', get_defined_vars()) ?>

<div class="vt-lightbox" id="vt-lightbox" hidden role="dialog" aria-modal="true" aria-label="Photo">
  <button type="button" class="vt-lightbox__close" data-lightbox-close aria-label="Close"><?= icon('close') ?></button>
  <button type="button" class="vt-lightbox__nav vt-lightbox__nav--prev" data-lightbox-prev aria-label="Previous"><?= icon('chevron') ?></button>
  <img alt="" id="vt-lightbox-img">
  <button type="button" class="vt-lightbox__nav vt-lightbox__nav--next" data-lightbox-next aria-label="Next"><?= icon('chevron') ?></button>
</div>

<script>window.VT=<?= wp_json_encode($config, JSON_UNESCAPED_SLASHES) ?>;</script>
<?php if ($preview): ?>
<script><?= file_get_contents(VISION_TRIPS_DIR . 'assets/js/vision.js') ?></script>
<?php else: ?>
<script src="<?= e(VISION_TRIPS_URL . 'assets/js/vision.js?ver=' . \VisionTrips\Plugin::assetVersion('assets/js/vision.js')) ?>" defer></script>
<script>
/* Fail-safes that do not depend on vision.js: content must never stay hidden behind a skeleton. */
(function(){
  setTimeout(function(){ document.querySelectorAll('.vt-async[data-loaded="0"]').forEach(function(el){ if (!el.dataset.loading && !el.dataset.preview) { var s = el.closest('section'); if (s) { s.hidden = true; } else { el.remove(); } } }); }, 20000);
})();
</script>
<?php endif; ?>
</body>
</html>
