<?php
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;
use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$image = $surprise ? '' : $trip->heroImage();
$dest = $trip->destinationSummary();
$days = $trip->daysToGo();
$travellersCount = $trip->totalPax ?: count($trip->travellers);
$next = $trip->nextPayment();
$heroClass = 'vt-hero' . ($image !== '' ? ' has-image' : ' no-image') . ($surprise ? ' is-surprise' : '');
?>
<section class="<?= e($heroClass) ?>" aria-label="Trip summary"<?= $image !== '' ? ' style="--vt-hero-img:url(\'' . e($image) . '\')"' : '' ?>>
  <?php if ($image !== ''): ?><div class="vt-hero__img" role="img" aria-label="<?= e($dest ?: $trip->name) ?>"></div><?php endif; ?>
  <div class="vt-hero__body">
    <p class="vt-hero__kicker"><?= e($copy['kicker']) ?></p>
    <h1 class="vt-hero__title"><?= e($copy['headline']) ?></h1>
    <?php if ($copy['sub'] !== ''): ?><p class="vt-hero__sub"><?= e($copy['sub']) ?></p><?php endif; ?>

    <?php if (!$surprise && $trip->departs && !in_array($stage, [Stage::COUNTDOWN, Stage::CLOSED, Stage::CANCELLED], true)): ?>
      <ul class="vt-hero__facts" aria-label="Key facts">
        <li><?= icon('calendar') ?><span><?= e($trip->dateRange()) ?></span></li>
        <?php if ($trip->duration > 0): ?><li><?= icon('clock') ?><span><?= e($trip->duration) ?> night<?= $trip->duration === 1 ? '' : 's' ?></span></li><?php endif; ?>
        <?php if ($travellersCount > 0): ?><li><?= icon('users') ?><span><?= e($travellersCount) ?> traveller<?= $travellersCount === 1 ? '' : 's' ?></span></li><?php endif; ?>
      </ul>
    <?php endif; ?>

    <?php if ($stage === Stage::COUNTDOWN && !$surprise): ?>
      <?php
        $firstFlight = $trip->ofKind('flight')[0] ?? null;
        $departAt = $trip->departs->setTime(0, 0, 0);
        if ($firstFlight && $firstFlight->startTime !== '' && preg_match('/^(\d{2}):(\d{2})$/', $firstFlight->startTime, $tm)) {
            $departAt = $departAt->setTime((int) $tm[1], (int) $tm[2]);
        }
        $secs = max(0, $departAt->getTimestamp() - $now->getTimestamp());
        $cdD = intdiv($secs, 86400); $cdH = intdiv($secs % 86400, 3600); $cdM = intdiv($secs % 3600, 60);
      ?>
      <div class="vt-countdown" data-countdown="<?= e($departAt->format('Y-m-d\TH:i:s')) ?>" aria-live="off">
        <div><strong data-cd="d"><?= e($cdD) ?></strong><span>days</span></div>
        <div><strong data-cd="h"><?= e(str_pad((string) $cdH, 2, '0', STR_PAD_LEFT)) ?></strong><span>hours</span></div>
        <div><strong data-cd="m"><?= e(str_pad((string) $cdM, 2, '0', STR_PAD_LEFT)) ?></strong><span>mins</span></div>
        <span class="vt-countdown__cap"><?= $firstFlight && $firstFlight->fromCode !== '' ? 'until you fly from ' . e($firstFlight->fromCode) : 'until you leave' ?></span>
      </div>
    <?php endif; ?>

    <?php if ($trip->isQuote() && $trip->total > 0): ?>
      <div class="vt-hero__price">
        <span class="vt-hero__price-label">Total for <?= e($travellersCount ?: 'your party') ?><?= $travellersCount ? ($travellersCount === 1 ? ' traveller' : ' travellers') : '' ?></span>
        <span class="vt-hero__price-amount"><?= e($trip->money($trip->total)) ?></span>
        <?php $dep = $trip->depositPayment(); if ($dep && $dep->amount > 0 && $dep->amount < $trip->total): ?><span class="vt-hero__price-note">Secure it with a <?= e($dep->money()) ?> deposit</span><?php endif; ?>
      </div>
    <?php endif; ?>

    <div class="vt-hero__actions">
      <?php if ($stage === Stage::QUOTE && $quoteAccept && $copy['cta'] !== ''): ?>
        <a class="vt-btn vt-btn--primary" href="#accept" data-open-accept><?= e($copy['cta']) ?></a>
        <a class="vt-btn vt-btn--ghost" href="#help" data-ask><?= e($copy['cta2']) ?></a>
      <?php elseif ($stage === Stage::QUOTE && $copy['cta'] === ''): ?>
        <a class="vt-btn vt-btn--ghost" href="#help" data-ask><?= e($copy['cta2']) ?></a>
      <?php elseif ($stage === Stage::QUOTE): ?>
        <a class="vt-btn vt-btn--primary" href="#help" data-ask>Let us know you'd like to go ahead</a>
      <?php elseif (in_array($stage, [Stage::QUOTE_EXPIRED, Stage::CLOSED, Stage::CANCELLED], true)): ?>
        <a class="vt-btn vt-btn--primary" href="#help" data-ask><?= e($copy['cta']) ?></a>
      <?php elseif ($stage === Stage::COUNTDOWN): ?>
        <?php if ($next && $trip->balance > 0.009 && $next->link !== ''): ?><a class="vt-btn vt-btn--primary" href="<?= e($next->link) ?>" rel="noopener">Pay <?= e($next->money()) ?><?= $next->due ? ' by ' . e(Dates::medium($next->due)) : '' ?></a><?php endif; ?>
        <?php if (!$surprise): ?><a class="vt-btn vt-btn--ghost" href="<?= e($urls['ics']) ?>"><?= icon('calendar') ?> Add to calendar</a><?php endif; ?>
      <?php elseif ($stage === Stage::PREP || $stage === Stage::CONFIRMED): ?>
        <a class="vt-btn vt-btn--primary" href="#documents"><?= icon('doc') ?> My documents</a>
        <?php if ($next && $trip->balance > 0.009 && $next->link !== ''): ?><a class="vt-btn vt-btn--ghost" href="<?= e($next->link) ?>" rel="noopener">Pay <?= e($next->money()) ?></a><?php endif; ?>
      <?php elseif ($away): ?>
        <?php $ooh = $brand->emergencyPhone !== '' ? $brand->emergencyPhone : $trip->emergencyPhone; ?>
        <?php if ($ooh !== ''): ?><a class="vt-btn vt-btn--primary" href="<?= e(tel($ooh)) ?>"><?= icon('phone') ?> Emergency line</a><?php endif; ?>
        <a class="vt-btn vt-btn--ghost" href="#itinerary">What's next</a>
      <?php elseif ($home): ?>
        <?php $review = $brand->googleReviews !== '' ? $brand->googleReviews : $brand->trustpilot; ?>
        <?php if ($review !== ''): ?><a class="vt-btn vt-btn--primary" href="<?= e($review) ?>" rel="noopener" target="_blank"><?= icon('star') ?> <?= e($copy['cta']) ?></a><?php endif; ?>
        <a class="vt-btn vt-btn--ghost" href="#help" data-ask><?= e($copy['cta2']) ?></a>
      <?php endif; ?>
    </div>
  </div>
</section>
