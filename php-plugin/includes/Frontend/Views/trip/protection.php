<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$p = $trip->protection;
$notice = \VisionTrips\Domain\Legal::notice($trip);
$badges = array_values(array_filter($brand->displayLogos, static fn ($l) => !(strtoupper(trim($l)) === 'ATOL' && !$p->atolApplies())));
$sections = [];
foreach (['important' => 'Important information', 'total_price' => 'About the price', 'flight' => 'Flights', 'insurance' => 'Travel insurance', 'travel_aware' => 'Travel aware', 'correct_names' => 'Names on your booking', 'terms' => 'Booking terms and conditions', 'ptr' => 'Package travel regulations'] as $k => $label) {
    if (!empty($brand->templates[$k])) {
        $sections[$label] = $brand->templates[$k];
    }
}
?>
<section class="vt-section" id="protection" aria-labelledby="prot-h">
  <h2 class="vt-h2" id="prot-h">Who you're booking with</h2>
  <div class="vt-prot">
    <div class="vt-prot__card">
      <?= icon('shield') ?>
      <div>
        <strong><?= e($brand->memberCompany ?: $brand->name) ?></strong>
        <span><?= e($brand->propositionLabel() !== '' ? $brand->propositionLabel() . ' member' : 'Independent travel agent') ?><?= $brand->memberNumber !== '' ? ' ' . e($brand->memberNumber) : '' ?></span>
        <?php if ($p->atolApplies() && $p->holderLabel() !== ''): ?><span class="vt-prot__atol">ATOL protected · <?= e($p->holderLabel()) ?></span><?php elseif ($p->atolApplies()): ?><span class="vt-prot__atol">ATOL protected</span><?php endif; ?>
        <span class="vt-prot__trust"><?= e($p->summarySentence()) ?></span>
      </div>
    </div>
    <?php if ($p->ticketAgent): ?><div class="vt-notice vt-notice--warn"><h4>Not ATOL protected</h4><?= \VisionTrips\Domain\Legal::text('ticket_agent', $trip) ?></div><?php endif; ?>
    <?php if ($notice && !$p->ticketAgent): ?><div class="vt-notice"><h4><?= e($notice['title']) ?></h4><?= raw($notice['html']) ?></div><?php endif; ?>
    <?php if ($badges): ?>
      <ul class="vt-badges" role="list" aria-label="Memberships and protection">
        <?php foreach ($badges as $logo): ?><li><?= e($logo) ?></li><?php endforeach; ?>
      </ul>
    <?php endif; ?>
    <details class="vt-more"><summary><span>Key information about this booking</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= \VisionTrips\Domain\Legal::keyInformationHtml($trip) ?></div></details>
    <details class="vt-more"><summary><span>How your money is protected</span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= partial('trip/protection-text', get_defined_vars()) ?></div></details>
    <?php foreach ($sections as $label => $html): ?>
      <details class="vt-more"><summary><span><?= e($label) ?></span><?= icon('chevron') ?></summary><div class="vt-longtext"><?= raw($html) ?></div></details>
    <?php endforeach; ?>
  </div>
</section>
