<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Dates;

/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = 'Safe Seat Plan guarantee';
echo partial('documents/_open', get_defined_vars());
?>
  <h1 class="vt-page__title">Stand Alone Safe Seat Plan Guarantee Certificate</h1>
  <p class="vt-page__sub">Travel Trust Association</p>
  <dl class="vt-meta">
    <div><dt>Reference</dt><dd><?= e($trip->ref) ?></dd></div>
    <div><dt>Date of issue</dt><dd><?= e(Dates::numeric($trip->bookingDate ?? $trip->createdAt)) ?></dd></div>
    <div><dt>Lead passenger</dt><dd><?= e($trip->lead ? $trip->lead->name : '') ?></dd></div>
    <div><dt>Number of passengers</dt><dd><?= e($trip->totalPax) ?></dd></div>
    <div><dt>Departure</dt><dd><?= e(Dates::numeric($trip->departs)) ?></dd></div>
    <div><dt>Return</dt><dd><?= e(Dates::numeric($trip->returns)) ?></dd></div>
    <div><dt>TTA member</dt><dd><?= e($brand->memberCompany ?: $brand->name) ?><?= $brand->memberNumber !== '' ? ' (' . e($brand->memberNumber) . ')' : '' ?></dd></div>
  </dl>
  <div class="vt-doc__long">
    <p>This Certificate of Guarantee is issued to the above customers by the Travel Trust Association (TTA), guaranteeing the due performance by a Member of the TTA of its financial obligations under a contract between the certificate holder and the TTA Member, where an act of fraud or dishonesty results in a third-party provider of components (as defined by the Package Travel and Linked Travel Arrangements Regulations 2018) not being paid in full or in part for those components. The TTA guarantees the financial obligation of the TTA Member to the certificate holder to repay the amount paid by the certificate holder to the TTA Member in those circumstances.</p>
    <p>Travel Trust Association members operate trust accounts to provide financial protection for the consumer. You can confirm this member's status at thetravelnetworkgroup.co.uk/verify-a-member or by calling 01483 545 780.</p>
    <p>Travel Trust Association is a trading name of TTA Management Ltd, St Andrews House, West Street, Woking, Surrey, GU21 6EB. Company registration number 2884750.</p>
  </div>
<?= partial('documents/_close', get_defined_vars()) ?>
