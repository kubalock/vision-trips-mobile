<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

/**
 * Financial protection and contract type as shown to the customer.
 *
 * Inputs: the booking's ATOL select, its Licensing select (richer: distinguishes principal vs agent sales, ticket-agent
 * flight sales, non-air packages and accommodation-only), the member proposition and T-ATOL status, the lead supplier
 * and ATOL number. Mirrors the rules the ATOL certificate uses, and never describes something as ATOL protected
 * unless the licensing says it is.
 */
final class Protection
{
    public string $mode = 'not_applicable';
    public string $contractType = 'unknown';   // package | package_no_flight | flight_only | accommodation_only | agent_services | ticket_agent | unknown
    public string $holderName = '';
    public string $holderNumber = '';
    public string $organiserName = '';
    public bool $hasFlight = false;
    public bool $isGlobal = false;
    public bool $isIte = false;
    public bool $isTta = false;
    public bool $ticketAgent = false;
    public bool $hideSuppliers = false;
    public string $atolSelect = '';
    public string $licensing = '';
    public string $trustLabel = '';
    /** True when the member sells a package as retailer for an ATOL holder it is not (no T-ATOL). */
    public bool $retailerOnly = false;

    public static function build(string $atolSelect, bool $hasFlight, Brand $brand, string $bookingAtolNo, string $leadSupplierName, bool $useGlobalAtol = false, string $licensing = ''): self
    {
        $p = new self();
        $prop = $brand->propositionKey();
        $p->isGlobal = $prop === 'global';
        $p->isIte = $prop === 'ite';
        $p->isTta = $prop === 'tta';
        $p->hasFlight = $hasFlight;
        $p->atolSelect = $atolSelect;
        $p->licensing = $licensing;
        // Only claim a trust account when we know one exists (TTA members, or a brand with trust account details in Vision).
        $p->trustLabel = $p->isTta ? 'Travel Trust Association trust account' : ($brand->trustAccountNumber !== '' ? 'client trust account' : '');
        $member = $brand->memberCompany ?: $brand->name;

        $lic = strtolower($licensing);
        $p->mode = self::resolveMode($atolSelect, $hasFlight, $p->isGlobal);
        // Licensing refines the mode where it is explicit.
        if (str_contains($lic, 'airline ticket agent')) {
            $p->ticketAgent = true;
            $p->mode = 'not_applicable';
            $p->contractType = 'ticket_agent';
        } elseif (str_contains($lic, 'accommodation only')) {
            $p->mode = 'not_applicable';
            $p->contractType = 'accommodation_only';
        } elseif (str_contains($lic, 'non-air package')) {
            $p->mode = 'principal_package_no_flight';
            $p->contractType = 'package_no_flight';
        } elseif (str_contains($lic, 'other sales as an agent')) {
            $p->mode = 'not_applicable';
            $p->contractType = 'agent_services';
        } elseif (str_contains($lic, "other atol holders' packages") || str_contains($lic, 'atol to atol')) {
            $p->mode = str_contains($lic, 'multi') ? 'agent_multi_contract' : 'agent_single_contract';
            $p->contractType = 'package';
        } elseif (str_contains($lic, 'flight-only sales as agent')) {
            $p->mode = 'agent_flight_only';
            $p->contractType = 'flight_only';
        } elseif (str_contains($lic, 'flight-only')) {
            $p->mode = 'principal_flight_only';
            $p->contractType = 'flight_only';
        } elseif (str_contains($lic, 'package (principal')) {
            $p->mode = str_contains($lic, 'multi') ? 'principal_multi_contract' : 'principal_single_contract';
            $p->contractType = 'package';
        } else {
            $p->contractType = match (true) {
                $p->mode === 'principal_package_no_flight' => 'package_no_flight',
                str_ends_with($p->mode, 'flight_only') => 'flight_only',
                self::isAgent($p->mode) || self::isPrincipal($p->mode) => 'package',
                default => 'unknown',
            };
        }

        // A member that holds no ATOL of its own cannot be the ATOL holder: the booking's ATOL number belongs to the
        // package organiser (the lead supplier) and the member is the retailer. Re-class such sales as agent sales.
        $memberHoldsAtol = $p->isGlobal || $useGlobalAtol || $p->isIte || ($brand->memberTAtolEnabled && $brand->memberTAtolNumber !== '');
        if (self::isPrincipal($p->mode) && !$memberHoldsAtol) {
            $p->mode = str_ends_with($p->mode, 'flight_only') ? 'agent_flight_only' : (str_contains($p->mode, 'multi') ? 'agent_multi_contract' : 'agent_single_contract');
            $p->retailerOnly = true;
        }
        if (self::isAgent($p->mode)) {
            $p->holderName = $leadSupplierName;
            $p->holderNumber = self::firstNumber($bookingAtolNo);
            $p->organiserName = $leadSupplierName;
        } elseif (self::isPrincipal($p->mode)) {
            if ($p->isGlobal || $useGlobalAtol) {
                $p->holderName = 'The Global Travel Group Ltd';
                $p->holderNumber = '3973';
            } elseif ($p->isIte) {
                $p->holderName = 'Independent Travel Experts Ltd';
                $p->holderNumber = 'T7400';
            } elseif ($brand->memberTAtolEnabled && $brand->memberTAtolNumber !== '') {
                $p->holderName = $member;
                $p->holderNumber = self::firstNumber($brand->memberTAtolNumber);
            } else {
                $p->holderName = $member;
                $p->holderNumber = self::firstNumber($bookingAtolNo);
            }
            $p->organiserName = $p->holderName;
        } elseif ($p->contractType === 'package_no_flight') {
            $p->organiserName = $member;
        }
        $p->hideSuppliers = ($p->isGlobal || $p->isIte) && strcasecmp(trim($atolSelect), 'Single-Contract Package') === 0;
        return $p;
    }

    public static function resolveMode(string $atolSelect, bool $hasFlight, bool $isGlobal): string
    {
        $choice = (string) preg_replace('/\s+/', ' ', strtolower(trim($atolSelect)));
        if (str_contains($choice, 'agent of atol holder')) {
            if (str_contains($choice, 'flight only')) {
                return 'agent_flight_only';
            }
            return str_contains($choice, 'multi') ? 'agent_multi_contract' : 'agent_single_contract';
        }
        if (str_contains($choice, 'not applicable') || $choice === 'n/a' || $choice === 'na') {
            return 'not_applicable';
        }
        if (str_contains($choice, 'single') && str_contains($choice, 'no flight')) {
            return 'principal_package_no_flight';
        }
        if (str_contains($choice, 'multi')) {
            return 'principal_multi_contract';
        }
        if (str_contains($choice, 'single')) {
            return 'principal_single_contract';
        }
        if (str_contains($choice, 'flight only') || str_contains($choice, 'flight-only')) {
            return 'principal_flight_only';
        }
        if ($isGlobal && $hasFlight) {
            return 'principal_single_contract';
        }
        return $hasFlight ? 'agent_single_contract' : 'not_applicable';
    }

    public static function isAgent(string $mode): bool
    {
        return str_starts_with($mode, 'agent_');
    }

    public static function isPrincipal(string $mode): bool
    {
        return str_starts_with($mode, 'principal_') && $mode !== 'principal_package_no_flight';
    }

    public function atolApplies(): bool
    {
        return !$this->ticketAgent && $this->hasFlight && (self::isAgent($this->mode) || self::isPrincipal($this->mode));
    }

    public function isPackage(): bool
    {
        return in_array($this->contractType, ['package', 'package_no_flight'], true);
    }

    public function holderLabel(): string
    {
        if ($this->holderName === '' && $this->holderNumber === '') {
            return '';
        }
        $name = $this->holderName !== '' ? $this->holderName : 'the package organiser';
        return trim($name . ($this->holderNumber !== '' ? ' (ATOL ' . $this->holderNumber . ')' : ''));
    }

    /** Wording for money that sits outside ATOL. Empty when we cannot vouch for a trust arrangement. */
    public function trustSentence(): string
    {
        if ($this->trustLabel === '') {
            return '';
        }
        return 'Money for arrangements outside ATOL is held in ' . ($this->isTta ? 'the ' : 'a ') . $this->trustLabel . ' until it is passed to the supplier.';
    }

    public function packageLabel(): string
    {
        return match ($this->mode) {
            'principal_single_contract', 'agent_single_contract' => 'Package (single contract)',
            'principal_multi_contract', 'agent_multi_contract' => 'Package (multi contract)',
            'principal_flight_only', 'agent_flight_only' => 'Flight only',
            'principal_package_no_flight' => 'Package (no flight)',
            default => '',
        };
    }

    /** The entity providing insolvency protection, for legal texts. */
    public function protectionEntity(): string
    {
        if ($this->atolApplies() && $this->holderLabel() !== '') {
            return 'the ATOL scheme (ATOL holder ' . $this->holderLabel() . ')';
        }
        if ($this->atolApplies()) {
            return 'the ATOL scheme';
        }
        if ($this->trustLabel === '') {
            return 'the arrangements set out in your booking conditions';
        }
        return $this->isTta ? 'the Travel Trust Association trust account arrangements' : 'a ' . $this->trustLabel;
    }

    /** One plain sentence for key-information blocks. */
    public function summarySentence(): string
    {
        if ($this->ticketAgent) {
            return 'This flight is sold as an agent of the airline and is not ATOL protected. Your payment is passed to the airline.';
        }
        if ($this->atolApplies()) {
            $who = $this->holderLabel();
            $s = $this->isPackage() ? 'This flight-inclusive package is ATOL protected' : 'This flight is ATOL protected';
            if (self::isAgent($this->mode)) {
                $s .= $who !== '' ? '. The package organiser and ATOL holder is ' . $who : ' by the package organiser named on your ATOL Certificate';
                $s .= ', with your booking made through your travel agent as its retailer.';
            } else {
                $s .= $who !== '' ? ' under ' . $who . '.' : '.';
            }
            $s .= ' You will receive an ATOL Certificate when payment is taken.';
            $trust = $this->trustSentence();
            return $s . ($trust !== '' ? ' ' . $trust : '');
        }
        if ($this->contractType === 'package_no_flight') {
            return 'This package does not include a flight, so ATOL does not apply. Your payments are protected through ' . $this->protectionEntity() . ' as required by the Package Travel Regulations.';
        }
        return 'ATOL protection does not apply to this booking. Your payments are protected through ' . $this->protectionEntity() . '.';
    }

    /**
     * Protection applying to one element. @return array{scheme:string,label:string,detail:string}
     */
    public function forElement(Element $e, bool $anyExplicitPackage): array
    {
        $isFlight = $e->kind === 'flight';
        if ($this->ticketAgent && $isFlight) {
            return ['scheme' => 'none', 'label' => 'Not ATOL protected', 'detail' => 'Sold as an agent of the airline; your contract is with the airline.'];
        }
        $atol = false;
        $detail = '';
        if ($this->atolApplies()) {
            if (in_array($this->mode, ['agent_single_contract', 'agent_multi_contract'], true)) {
                $atol = $anyExplicitPackage ? $e->package : in_array($e->kind, ['flight', 'stay', 'cruise', 'train', 'carhire'], true);
                $detail = $atol ? 'Part of the ATOL-protected package.' : 'Arranged separately; not part of the ATOL-protected package.';
            } elseif (str_ends_with($this->mode, 'flight_only')) {
                $atol = $isFlight;
                $detail = $atol ? 'Flight protected under the ATOL scheme.' : 'Arranged separately; not covered by the flight-only ATOL protection.';
            } else {
                $atol = true;
                $detail = 'Included in your ATOL-protected package.';
            }
        }
        if ($atol) {
            return ['scheme' => 'atol', 'label' => 'ATOL protected', 'detail' => $detail . ($this->holderLabel() !== '' ? ' ATOL holder: ' . $this->holderLabel() . '.' : '')];
        }
        if ($this->trustLabel === '') {
            return ['scheme' => 'trust', 'label' => 'Protected per booking conditions', 'detail' => ($detail !== '' ? $detail . ' ' : '') . 'Protection for this arrangement is set out in your booking conditions.'];
        }
        return ['scheme' => 'trust', 'label' => ucfirst($this->trustLabel), 'detail' => ($detail !== '' ? $detail . ' ' : '') . 'Money paid for this arrangement is held in the ' . $this->trustLabel . ' until it is passed to the supplier.'];
    }

    private static function firstNumber(string $raw): string
    {
        $parts = preg_split('/[,;|]+/', trim($raw)) ?: [];
        $first = trim((string) ($parts[0] ?? ''));
        $norm = strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $first));
        return in_array($norm, ['', 'na', 'notapplicable', 'none', 'null', 'unknown', 'tbc', 'tba'], true) ? '' : $first;
    }
}
