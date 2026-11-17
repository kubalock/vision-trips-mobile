<?php
namespace VisionTrips\Frontend;

/** The member's walkthrough (Video Walkthrough attachment, or a Video Message link): a slim card beneath the note. */
/** @var \VisionTrips\Domain\Trip $trip */
$walk = null;
if ($trip->videoWalkthrough) {
    $walk = ['src' => $trip->videoWalkthrough['url'], 'kind' => 'file', 'poster' => $trip->videoWalkthrough['poster']];
} elseif ($trip->videoMessage !== '' && ($vm = \VisionTrips\Integrations\Widgety::videoEmbed($trip->videoMessage))) {
    $walk = ['src' => $vm['src'], 'kind' => $vm['kind'], 'poster' => ''];
}
if (!$walk) {
    return;
}
$first = $trip->agentName !== '' ? \VisionTrips\Support\Str::firstName($trip->agentName) : $brand->name;
?>
<section class="vt-walk" data-walk data-video="<?= e($walk['src']) ?>" data-video-kind="<?= e($walk['kind']) ?>" aria-label="Video walkthrough">
  <button type="button" class="vt-walk__thumb" data-walk-play aria-label="Watch the walkthrough"<?= $walk['poster'] !== '' ? ' style="--vt-walk-poster:url(\'' . e($walk['poster']) . '\')"' : '' ?>><?= icon('play') ?></button>
  <div class="vt-walk__body">
    <strong><?= e($first) ?> recorded a walkthrough of <?= $trip->isQuote() ? 'this quotation' : 'your trip' ?></strong>
    <span>A personal run-through of what's been put together for you.</span>
  </div>
  <button type="button" class="vt-btn vt-btn--primary vt-btn--sm" data-walk-play><?= icon('play') ?> Watch</button>
</section>
