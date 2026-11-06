<?php
namespace VisionTrips\Frontend;
?>
  <footer class="vt-page__foot">
    <p><?= e($brand->legalLine()) ?></p>
    <?php if ($trip->protection->atolApplies() && $trip->protection->holderLabel() !== ''): ?><p>ATOL protected: <?= e($trip->protection->holderLabel()) ?>.</p><?php endif; ?>
    <?php if ($brand->memberDisclaimer !== ''): ?><div class="vt-page__disclaimer"><?= raw($brand->memberDisclaimer) ?></div><?php endif; ?>
    <p class="vt-page__gen">Generated <?= e($issuedOn) ?> · <?= e($trip->ref) ?></p>
  </footer>
</article>
</body>
</html>
