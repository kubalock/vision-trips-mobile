<?php
declare(strict_types=1);

namespace VisionTrips\Airtable;

use VisionTrips\Support\Arr;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * The customer's own account in Vision, for the portal: loyalty standing and history, and the travel details of the
 * people on the account (passport, driving licence, next of kin, airline and cruise loyalty programmes).
 *
 * Writes are deliberately narrow: a fixed allow-list of fields on the person records that belong to the signed-in
 * customer's own Customers record(s), each value validated server-side, and never a name, date of birth or contact
 * detail (those change every linked booking, so the member handles them). Every change leaves a comment on the
 * customer record so the member can see it.
 */
final class AccountRepository
{
    public function __construct(private Client $client, private BookingRepository $bookings)
    {
    }

    /** @return array{enabled:bool,vip:bool,available:int,lifetime:int,value:float,expiry:?\DateTimeImmutable,transactions:array<int,array<string,mixed>>} */
    public function loyalty(string $base, string $email, bool $memberEnabled): array
    {
        $out = ['enabled' => $memberEnabled, 'vip' => false, 'available' => 0, 'lifetime' => 0, 'value' => 0.0, 'expiry' => null, 'transactions' => []];
        $customers = $this->bookings->findCustomers($base, $email);
        $txIds = [];
        foreach ($customers as $c) {
            $f = $c['fields'] ?? [];
            $out['vip'] = $out['vip'] || Arr::truthy(FieldMap::pick($f, 'customer', 'vip'));
            $out['available'] += (int) round(Arr::number(FieldMap::pick($f, 'customer', 'points_available')));
            $out['lifetime'] += (int) round(Arr::number(FieldMap::pick($f, 'customer', 'points_lifetime')));
            $out['value'] += (float) Arr::number(FieldMap::pick($f, 'customer', 'points_value'));
            $exp = Dates::parse(FieldMap::pick($f, 'customer', 'points_expiry'));
            if ($exp && (!$out['expiry'] || $exp < $out['expiry'])) {
                $out['expiry'] = $exp;
            }
            $txIds = array_merge($txIds, Arr::recordIds(FieldMap::pick($f, 'customer', 'loyalty_tx')));
        }
        if ($txIds) {
            $rows = $this->client->byIds($base, FieldMap::table('loyalty_tx'), array_slice(array_unique($txIds), 0, 100));
            $bookingIds = [];
            foreach ($rows as $r) {
                $bookingIds = array_merge($bookingIds, Arr::recordIds($r['fields']['Booking'] ?? []));
            }
            $refs = [];
            if ($bookingIds) {
                foreach ($this->client->byIds($base, FieldMap::table('bookings'), array_slice(array_unique($bookingIds), 0, 50), ['Booking Reference', 'Trip Name']) as $b) {
                    $refs[(string) $b['id']] = Str::clean($b['fields']['Trip Name'] ?? '') ?: Str::clean(Arr::first($b['fields']['Booking Reference'] ?? ''));
                }
            }
            foreach ($rows as $r) {
                $f = $r['fields'] ?? [];
                $out['transactions'][] = [
                    'type'    => Str::clean($f['Transaction Type'] ?? ''),
                    'points'  => (int) round(Arr::number($f['Points'] ?? 0)),
                    'date'    => Dates::parse($f['Date'] ?? null),
                    'notes'   => Str::clean($f['Notes'] ?? ''),
                    'booking' => $refs[(string) (Arr::recordIds($f['Booking'] ?? [])[0] ?? '')] ?? '',
                ];
            }
            usort($out['transactions'], static fn ($a, $b) => ($b['date']?->getTimestamp() ?? 0) <=> ($a['date']?->getTimestamp() ?? 0));
        }
        return $out;
    }

    /**
     * The people on the customer's account with the details they may keep up to date.
     * @return array<int,array<string,mixed>>
     */
    public function people(string $base, string $email): array
    {
        $customers = $this->bookings->findCustomers($base, $email);
        $peopleIds = [];
        $customerIds = [];
        foreach ($customers as $c) {
            $customerIds[] = (string) $c['id'];
            $peopleIds = array_merge($peopleIds, Arr::recordIds(FieldMap::pick($c['fields'] ?? [], 'customer', 'people')));
        }
        $peopleIds = array_values(array_unique($peopleIds));
        if (!$peopleIds) {
            return [];
        }
        $rows = $this->client->byIds($base, FieldMap::table('people'), array_slice($peopleIds, 0, 20));
        $loyaltyIds = [];
        $cruiseIds = [];
        foreach ($rows as $r) {
            $loyaltyIds = array_merge($loyaltyIds, Arr::recordIds(FieldMap::pick($r['fields'] ?? [], 'person', 'airline_loyalty')));
            $cruiseIds = array_merge($cruiseIds, Arr::recordIds(FieldMap::pick($r['fields'] ?? [], 'person', 'cruise_loyalty')));
        }
        $loyalty = $loyaltyIds ? $this->client->byIds($base, FieldMap::table('airline_loyalty'), array_slice(array_unique($loyaltyIds), 0, 40)) : [];
        $cruise = $cruiseIds ? $this->client->byIds($base, FieldMap::table('cruise_loyalty'), array_slice(array_unique($cruiseIds), 0, 40)) : [];
        $programmes = [];
        foreach ($loyalty as $l) {
            $f = $l['fields'] ?? [];
            $programmes[(string) $l['id']] = ['id' => (string) $l['id'], 'kind' => 'airline', 'name' => $this->nameOf($base, 'airlines', Arr::recordIds($f['Airline'] ?? [])), 'number' => Str::clean($f['Membership Number'] ?? ''), 'tier' => Str::clean($f['Tier/Status'] ?? '')];
        }
        foreach ($cruise as $l) {
            $f = $l['fields'] ?? [];
            $programmes[(string) $l['id']] = ['id' => (string) $l['id'], 'kind' => 'cruise', 'name' => $this->nameOf($base, 'operators', Arr::recordIds($f['Cruise Operator'] ?? [])), 'number' => Str::clean($f['Membership Number'] ?? ''), 'tier' => Str::clean($f['Tier/Status'] ?? '')];
        }
        $out = [];
        foreach ($rows as $r) {
            $f = $r['fields'] ?? [];
            $p = static fn (string $k) => FieldMap::pick($f, 'person', $k);
            $own = array_intersect(Arr::recordIds($p('customers')), $customerIds) !== [];
            if (!$own) {
                continue; // belongs to a different account that merely shares an email history
            }
            $progs = [];
            foreach (array_merge(Arr::recordIds($p('airline_loyalty')), Arr::recordIds($p('cruise_loyalty'))) as $pid) {
                if (isset($programmes[$pid])) {
                    $progs[] = $programmes[$pid];
                }
            }
            $out[] = [
                'id'               => (string) $r['id'],
                'name'             => Str::clean($p('name')) ?: trim(Str::clean($p('first')) . ' ' . Str::clean($p('last'))),
                'passport_number'  => Str::clean($p('passport_number')),
                'nationality'      => Str::clean($p('nationality')),
                'passport_issue'   => Dates::iso($p('passport_issue')),
                'passport_expiry'  => Dates::iso($p('passport_expiry')),
                'passport_country' => Str::clean($p('passport_country')),
                'licence_number'   => Str::clean($p('licence_number')),
                'licence_expiry'   => Dates::iso($p('licence_expiry')),
                'nok_name'         => Str::clean($p('nok_name')),
                'nok_phone'        => Str::clean($p('nok_phone')),
                'programmes'       => $progs,
            ];
        }
        return $out;
    }

    /** Which fields a customer may change on a person, with their validators (everything else is refused). */
    public const EDITABLE = ['passport_number', 'nationality', 'passport_issue', 'passport_expiry', 'passport_country', 'licence_number', 'licence_expiry', 'nok_name', 'nok_phone'];

    /**
     * Update a person on the signed-in customer's account. Returns ['ok'=>bool,'errors'=>[field=>message]].
     * @param array<string,string> $input
     * @return array{ok:bool,errors:array<string,string>}
     */
    public function updatePerson(string $base, string $email, string $personId, array $input): array
    {
        $people = $this->people($base, $email);
        $person = null;
        foreach ($people as $p) {
            if ($p['id'] === $personId) {
                $person = $p;
            }
        }
        if (!$person) {
            return ['ok' => false, 'errors' => ['_' => 'That person is not on your account.']];
        }
        $errors = [];
        $fields = [];
        $map = static fn (string $key) => FieldMap::candidates('person', $key)[0] ?? '';
        foreach (self::EDITABLE as $key) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $v = trim((string) $input[$key]);
            $v = (string) preg_replace('/\s+/', ' ', $v);
            switch ($key) {
                case 'passport_number':
                    $v = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $v));
                    if ($v !== '' && (strlen($v) < 5 || strlen($v) > 12)) {
                        $errors[$key] = 'A passport number is 5 to 12 letters and numbers.';
                    }
                    break;
                case 'licence_number':
                    $v = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $v));
                    if ($v !== '' && (strlen($v) < 5 || strlen($v) > 20)) {
                        $errors[$key] = 'That does not look like a licence number.';
                    }
                    break;
                case 'nationality':
                case 'passport_country':
                case 'nok_name':
                    $v = mb_substr($v, 0, 60);
                    if ($v !== '' && !preg_match('/^[\p{L}\p{M} \'.-]+$/u', $v)) {
                        $errors[$key] = 'Letters only, please.';
                    }
                    break;
                case 'nok_phone':
                    $v = (string) preg_replace('/[^0-9+ ()-]/', '', $v);
                    $digits = (string) preg_replace('/\D/', '', $v);
                    if ($v !== '' && (strlen($digits) < 7 || strlen($digits) > 15)) {
                        $errors[$key] = 'Please enter a full phone number.';
                    }
                    break;
                case 'passport_issue':
                case 'passport_expiry':
                case 'licence_expiry':
                    if ($v !== '') {
                        $d = Dates::parse($v);
                        if (!$d) {
                            $errors[$key] = 'Please use the date picker.';
                        } else {
                            $v = $d->format('Y-m-d');
                            if ($key === 'passport_issue' && $d > Dates::now()) {
                                $errors[$key] = 'An issue date cannot be in the future.';
                            }
                            if (($key === 'passport_expiry' || $key === 'licence_expiry') && $d < Dates::now()->modify('-20 years')) {
                                $errors[$key] = 'Please check that date.';
                            }
                        }
                    }
                    break;
            }
            $fields[$key] = $v;
        }
        if (isset($fields['passport_issue'], $fields['passport_expiry']) && $fields['passport_issue'] !== '' && $fields['passport_expiry'] !== '' && $fields['passport_expiry'] <= $fields['passport_issue']) {
            $errors['passport_expiry'] = 'Expiry must be after the issue date.';
        }
        if ($errors) {
            return ['ok' => false, 'errors' => $errors];
        }
        $payload = [];
        $changed = [];
        foreach ($fields as $key => $v) {
            $col = $map($key);
            if ($col === '') {
                continue;
            }
            $before = (string) ($person[$key] ?? '');
            if ($before === $v) {
                continue;
            }
            $payload[$col] = $v === '' ? null : $v;
            $changed[] = str_replace('_', ' ', $key);
        }
        if (!$payload) {
            return ['ok' => true, 'errors' => []];
        }
        $ok = $this->client->patch($base, FieldMap::table('people'), $personId, $payload);
        if ($ok) {
            $this->note($base, $email, 'updated ' . implode(', ', $changed) . ' for ' . $person['name']);
        } else {
            Log::warning('Account update failed', ['person' => $personId, 'fields' => array_keys($payload)]);
        }
        return ['ok' => $ok, 'errors' => $ok ? [] : ['_' => 'We could not save that just now. Please try again or contact us.']];
    }

    /**
     * Add or update an airline/cruise loyalty programme for a person on the account.
     * @return array{ok:bool,error:string}
     */
    public function saveProgramme(string $base, string $email, string $personId, string $kind, string $programmeId, string $operatorId, string $number, string $tier): array
    {
        $people = $this->people($base, $email);
        $person = null;
        foreach ($people as $p) {
            if ($p['id'] === $personId) {
                $person = $p;
            }
        }
        if (!$person) {
            return ['ok' => false, 'error' => 'That person is not on your account.'];
        }
        $kind = $kind === 'cruise' ? 'cruise' : 'airline';
        $number = strtoupper((string) preg_replace('/[^A-Za-z0-9-]/', '', $number));
        $tier = mb_substr(trim((string) preg_replace('/[^\p{L}\p{N} .\/+-]/u', '', $tier)), 0, 40);
        if ($number === '' || strlen($number) < 3 || strlen($number) > 24) {
            return ['ok' => false, 'error' => 'Please enter the membership number as it appears on your card or app.'];
        }
        $operatorId = (string) preg_replace('/[^A-Za-z0-9]/', '', $operatorId);
        $table = FieldMap::table($kind === 'cruise' ? 'cruise_loyalty' : 'airline_loyalty');
        $linkField = $kind === 'cruise' ? 'Cruise Operator' : 'Airline';
        if ($programmeId !== '') {
            $owned = false;
            foreach ($person['programmes'] as $pr) {
                if ($pr['id'] === $programmeId && $pr['kind'] === $kind) {
                    $owned = true;
                }
            }
            if (!$owned) {
                return ['ok' => false, 'error' => 'That programme is not on your account.'];
            }
            $fields = ['Membership Number' => $number, 'Tier/Status' => $tier];
            if ($operatorId !== '') {
                $fields[$linkField] = [$operatorId];
            }
            $ok = $this->client->patch($base, $table, $programmeId, $fields);
        } else {
            if ($operatorId === '') {
                return ['ok' => false, 'error' => $kind === 'cruise' ? 'Please choose the cruise line.' : 'Please choose the airline.'];
            }
            $id = $this->client->create($base, $table, ['Membership Number' => $number, 'Tier/Status' => $tier, $linkField => [$operatorId], 'Customers [People]' => [$personId]]);
            $ok = $id !== '';
        }
        if ($ok) {
            $this->note($base, $email, ($programmeId !== '' ? 'updated' : 'added') . ' a ' . $kind . ' loyalty programme for ' . $person['name']);
        }
        return ['ok' => $ok, 'error' => $ok ? '' : 'We could not save that just now. Please try again or contact us.'];
    }

    /** Operators the customer can pick from (airlines or cruise lines), cached for a day. @return array<string,string> id => name */
    public function operators(string $base, string $kind): array
    {
        $kind = $kind === 'cruise' ? 'cruise' : 'airline';
        $cached = Cache::get('portal-ops', $base . '|' . $kind);
        if (is_array($cached)) {
            return $cached;
        }
        $table = FieldMap::table($kind === 'cruise' ? 'operators' : 'airlines');
        $nameField = $kind === 'cruise' ? (FieldMap::candidates('operator', 'name')[0] ?? 'Name') : (FieldMap::candidates('airline', 'name')[0] ?? 'Name');
        $out = [];
        foreach ($this->client->find($base, $table, 'TRUE()', [$nameField], 500) as $r) {
            $n = Str::clean($r['fields'][$nameField] ?? '');
            if ($n !== '') {
                $out[(string) $r['id']] = $n;
            }
        }
        asort($out, SORT_NATURAL | SORT_FLAG_CASE);
        Cache::set('portal-ops', $base . '|' . $kind, $out, DAY_IN_SECONDS);
        return $out;
    }

    private function nameOf(string $base, string $kind, array $ids): string
    {
        if (!$ids) {
            return '';
        }
        $ops = $this->operators($base, $kind === 'operators' ? 'cruise' : 'airline');
        return $ops[$ids[0]] ?? '';
    }

    private function note(string $base, string $email, string $what): void
    {
        foreach ($this->bookings->findCustomers($base, $email) as $c) {
            $this->client->comment($base, FieldMap::table('customers'), (string) $c['id'], '📝 Customer ' . $what . ' in My Trips — ' . gmdate('D j M Y H:i') . ' UTC');
            break;
        }
    }
}
