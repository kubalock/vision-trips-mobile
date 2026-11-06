<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$faqs = $trip->faqs();
if (!$faqs) {
    return;
}
?>
<section class="vt-section" id="answers" aria-labelledby="faq-h">
  <h2 class="vt-h2" id="faq-h">Quick answers</h2>
  <div class="vt-faq">
    <?php foreach ($faqs as $f): ?>
      <details class="vt-more"><summary><span><?= e($f['q']) ?></span><?= icon('chevron') ?></summary><div class="vt-longtext"><p><?= e($f['a']) ?></p></div></details>
    <?php endforeach; ?>
  </div>
  <p class="vt-small">Not answered? <a class="vt-link" href="#help" data-ask>Send us a message</a> — a real person at <?= e($brand->name) ?> replies.</p>
</section>
