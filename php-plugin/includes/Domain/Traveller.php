<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use DateTimeImmutable;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Support\Arr;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

final class Traveller
{
    public string $id = '';
    public string $name = '';
    public string $first = '';
    public string $last = '';
    public ?DateTimeImmutable $dob = null;
    public ?int $age = null;
    public bool $isLead = false;
    public bool $isInfant = false;
    public ?DateTimeImmutable $passportExpiry = null;
    public string $nationality = '';
    /** @var string[] */
    public array $ssr = [];
    /** @var string[] */
    public array $meals = [];
    public bool $hasInsuranceDoc = false;

    public static function fromPerson(array $record): self
    {
        $t = new self();
        $f = $record['fields'] ?? [];
        $p = static fn (string $k) => FieldMap::pick($f, 'person', $k);
        $t->id = (string) ($record['id'] ?? '');
        $t->first = Str::clean($p('first'));
        $t->last = Str::clean($p('last'));
        $t->name = Str::clean($p('name')) ?: trim($t->first . ' ' . $t->last);
        if ($t->first === '' && $t->name !== '') {
            $t->first = Str::firstName($t->name);
        }
        if ($t->last === '' && $t->name !== '') {
            $t->last = Str::lastName($t->name);
        }
        $t->dob = Dates::parse($p('dob'));
        $age = $p('age');
        $t->age = is_numeric(Arr::first($age)) ? (int) Arr::first($age) : ($t->dob ? (int) $t->dob->diff(Dates::now())->y : null);
        $t->isInfant = $t->age !== null && $t->age < 2;
        $t->passportExpiry = Dates::parse($p('passport_expiry'));
        $t->nationality = Str::clean($p('nationality'));
        $t->ssr = Arr::strings($p('ssr'));
        $t->meals = Arr::strings($p('meal'));
        $t->hasInsuranceDoc = Arr::attachments($p('insurance')) !== [];
        return $t;
    }

    public static function fromCustomer(array $record): self
    {
        $t = new self();
        $f = $record['fields'] ?? [];
        $t->id = (string) ($record['id'] ?? '');
        $t->first = Str::clean(FieldMap::pick($f, 'customer', 'first'));
        $t->last = Str::clean(FieldMap::pick($f, 'customer', 'last'));
        $t->name = Str::clean(FieldMap::pick($f, 'customer', 'name')) ?: trim($t->first . ' ' . $t->last);
        $t->isLead = true;
        return $t;
    }

    public function initials(): string
    {
        return Str::initials($this->name);
    }

    /** True when the passport expires less than $months after the given date. */
    public function passportShort(?DateTimeImmutable $returnDate, int $months = 6): bool
    {
        if (!$this->passportExpiry || !$returnDate) {
            return false;
        }
        return $this->passportExpiry < $returnDate->modify('+' . $months . ' months');
    }
}
