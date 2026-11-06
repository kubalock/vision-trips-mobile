<?php
namespace VisionTrips\Frontend;

$docTitle = 'Documents';
echo partial('documents/_open', get_defined_vars());
?>
  <h1 class="vt-page__title">Documents for <?= e($trip->ref) ?></h1>
  <ul class="vt-doclist">
    <li><a href="<?= e($urls['confirmation']) ?>">Booking confirmation</a></li>
    <li><a href="<?= e($urls['invoice']) ?>">Invoice</a></li>
    <li><a href="<?= e($urls['receipts']) ?>">Receipts</a></li>
    <?php if ($trip->protection->atolApplies()): ?><li><a href="<?= e($urls['atol']) ?>">ATOL certificate</a></li><?php endif; ?>
    <?php if ($isAgent): ?><li><a href="<?= e($urls['letter']) ?>">Letter (agent)</a></li><li><a href="<?= e($urls['print']) ?>">Front file (agent)</a></li><?php endif; ?>
  </ul>
<?= partial('documents/_close', get_defined_vars()) ?>
