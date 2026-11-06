<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$p = $trip->protection;
$company = $brand->memberCompany ?: $brand->name;
$html = '<p><strong>' . e($company) . '</strong>' . ($brand->memberNumber !== '' ? ' (' . e($brand->propositionLabel()) . ' member ' . e($brand->memberNumber) . ')' : '') . ' is making this booking on your behalf.</p>';
if ($p->atolApplies() && $p->holderLabel() !== '') {
    $html .= '<p>' . (\VisionTrips\Domain\Protection::isAgent($p->mode) ? 'The flight-inclusive arrangements are protected under the ATOL of <strong>' . e($p->holderLabel()) . '</strong>, the package organiser. ' . e($company) . ' acts as retailer for this booking.' : 'This flight-inclusive package is protected under <strong>' . e($p->holderLabel()) . '</strong>.') . ' You will receive an ATOL Certificate when payment is taken. Keep it with your travel documents.</p>';
} elseif ($p->atolApplies()) {
    $html .= '<p>This flight-inclusive booking is ATOL protected by the package organiser. Your ATOL Certificate will name the ATOL holder.</p>';
}
if ($p->trustSentence() !== '') {
    $html .= '<p>' . e($p->trustSentence()) . '</p>';
}
if ($p->atolApplies()) {
    $html .= \VisionTrips\Domain\Legal::text('atol_statement', $trip);
}
$html .= \VisionTrips\Domain\Legal::text('trust_statement', $trip);
if (!empty($brand->templates['financial'])) {
    $html .= $brand->templates['financial'];
}
$html .= \VisionTrips\Domain\Legal::text('cancellation', $trip) . \VisionTrips\Domain\Legal::text('insurance', $trip);
if ($brand->legalLine() !== '') {
    $html .= '<p class="vt-small">' . e($brand->legalLine()) . '</p>';
}
echo $html;
