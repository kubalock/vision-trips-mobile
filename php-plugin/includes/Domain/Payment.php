<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use DateTimeImmutable;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Support\Arr;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

final class Payment
{
    public string $id = '';
    public float $amount = 0.0;
    public string $currency = 'GBP';
    public string $type = 'Customer Payment';     // Customer Payment | Customer Refund | Resort Payment | Write Off | Chargeback
    public string $customerType = '';             // Deposit Payment | Balance Payment | ...
    public string $status = 'Outstanding';        // Outstanding | Complete
    public ?DateTimeImmutable $due = null;
    public ?DateTimeImmutable $completed = null;
    public string $link = '';
    public string $agentLink = '';
    public string $method = '';
    public string $reference = '';
    public string $resortReason = '';
    public bool $showOnQuote = false;
    public string $travellerName = '';

    public static function fromRecord(array $record, array $nameCache = []): self
    {
        $p = new self();
        $f = $record['fields'] ?? [];
        $g = static fn (string $k) => FieldMap::pick($f, 'payment', $k);
        $p->id = (string) ($record['id'] ?? '');
        $p->currency = strtoupper(Str::clean($g('currency'))) ?: 'GBP';
        if (!in_array($p->currency, ['GBP', 'USD', 'EUR'], true)) {
            $p->currency = 'GBP';
        }
        $amountField = $p->currency === 'USD' ? 'usd_amount' : ($p->currency === 'EUR' ? 'eur_amount' : 'amount');
        $p->amount = Arr::number($g($amountField));
        if ($p->amount === 0.0) {
            $p->amount = Arr::number($g('amount'));
        }
        $p->type = Str::clean($g('type')) ?: ($p->amount < 0 ? 'Customer Refund' : 'Customer Payment');
        $p->customerType = Str::clean($g('customer_type'));
        $p->status = Str::clean($g('status')) ?: 'Outstanding';
        $p->due = Dates::parse($g('due'));
        $p->completed = Dates::parse($g('completed'));
        $p->link = Str::clean($g('link'));
        $p->agentLink = Str::clean($g('agent_link'));
        $p->method = Str::clean(self::resolve($g('method'), $nameCache));
        $p->reference = Str::clean($g('reference'));
        $p->resortReason = Str::clean($g('resort_reason'));
        $p->showOnQuote = Arr::truthy($g('show_on_quote'));
        $p->travellerName = Str::clean(self::resolve($g('traveller'), $nameCache));
        return $p;
    }

    private static function resolve(mixed $value, array $nameCache): string
    {
        $ids = Arr::recordIds($value);
        if ($ids) {
            $names = [];
            foreach ($ids as $id) {
                if (isset($nameCache[$id])) {
                    $names[] = $nameCache[$id];
                }
            }
            return implode(', ', $names);
        }
        return Str::clean($value);
    }

    public function isPaid(): bool
    {
        return preg_match('/complete|paid|settled/i', $this->status) === 1;
    }

    public function isRefund(): bool
    {
        return stripos($this->type, 'refund') !== false || $this->amount < 0;
    }

    public function isResort(): bool
    {
        return preg_match('/^\s*resort\s+payment\s*$/i', $this->type) === 1;
    }

    public function isCustomerPayment(): bool
    {
        return stripos($this->type, 'customer payment') !== false;
    }

    public function isOverdue(): bool
    {
        return !$this->isPaid() && $this->due !== null && $this->due < Dates::now()->setTime(0, 0, 0) && $this->isCustomerPayment();
    }

    public function label(): string
    {
        if ($this->isResort()) {
            return 'Payable locally';
        }
        if ($this->isRefund()) {
            return 'Refund';
        }
        if ($this->customerType !== '') {
            return $this->customerType;
        }
        return $this->isPaid() ? 'Payment received' : 'Payment due';
    }

    public function money(): string
    {
        return Str::money(abs($this->amount), $this->currency);
    }
}
