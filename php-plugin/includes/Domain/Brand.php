<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use VisionTrips\Airtable\FieldMap;
use VisionTrips\Support\Arr;
use VisionTrips\Support\Str;

/**
 * Everything the customer experience needs from "Brands & Branches" + "Members".
 * Built once per request from raw Airtable fields; safe to hand to templates (no secrets).
 */
final class Brand
{
    public string $id = '';
    public string $name = '';
    public string $slogan = '';
    public string $about = '';
    public string $tone = 'broad';          // formal | casual | broad
    public string $colour = '';
    public string $colour2 = '';
    public string $fontDisplay = '';
    public string $fontBody = '';
    public string $logo = '';
    public string $logoTransparent = '';
    public string $favicon = '';
    public string $hero = '';
    public string $teamPhoto = '';
    /** @var string[] */
    public array $images = [];
    public string $phone = '';
    public string $email = '';
    public string $web = '';
    public string $webDomain = '';
    public string $emergencyPhone = '';
    public string $oohLink = '';
    public string $oohEmail = '';
    public bool $hasPhysicalAddress = false;
    /** @var string[] */
    public array $addressLines = [];
    public string $mapsLink = '';
    public string $hours = '';
    /** @var array<string,string> */
    public array $social = [];
    public string $trustpilot = '';
    public string $googleReviews = '';
    /** @var string[] */
    public array $displayLogos = [];
    public string $privacyUrl = '';
    public string $complaintsUrl = '';
    /** @var string[] */
    public array $footerImages = [];
    public string $footerContent = '';
    /** @var array<string,string> key => rich text (html) */
    public array $templates = [];
    /** @var array<int,array{title:string,text:string}> */
    public array $reasons = [];
    public string $trustAccountName = '';
    public string $trustSortCode = '';
    public string $trustAccountNumber = '';
    public bool $mintAllowCustom = false;
    /** @var string[] */
    public array $mintMethods = [];
    public string $mintWebhook = '';
    public bool $mintConfigured = false;
    public string $proposition = '';
    /** @var array<int,array{id:string,name:string}> */
    public array $letterTemplates = [];

    // Member legal
    public string $memberCompany = '';
    public string $memberNumber = '';
    public string $memberRegNo = '';
    public string $memberVatNo = '';
    /** @var string[] */
    public array $memberOffice = [];
    public string $memberCountry = '';
    public string $memberProposition = '';
    public bool $memberTAtolEnabled = false;
    public string $memberTAtolNumber = '';
    public string $memberDisclaimer = '';

    /** Secrets kept private: never printed by templates. */
    private string $mintApiKey = '';
    private string $mintBusinessUnit = '';

    public static function fromRecords(array $brandRecord, array $memberRecord): self
    {
        $b = new self();
        $f = $brandRecord['fields'] ?? [];
        $m = $memberRecord['fields'] ?? [];
        $p = static fn (string $k) => FieldMap::pick($f, 'brand', $k);
        $pm = static fn (string $k) => FieldMap::pick($m, 'member', $k);

        $b->id = (string) ($brandRecord['id'] ?? '');
        $b->name = Str::clean($p('name')) ?: Str::clean($pm('company'));
        $b->slogan = Str::clean($p('slogan'));
        $b->about = Str::richText((string) Str::clean($p('about')));
        $tone = strtolower(Str::clean($p('tone')));
        $b->tone = str_contains($tone, 'formal') ? 'formal' : (str_contains($tone, 'casual') ? 'casual' : 'broad');
        $b->colour = self::hex(Str::clean($p('colour')));
        $b->colour2 = self::hex(Str::clean($p('colour2')));
        $b->fontDisplay = self::fontName(Str::clean($p('font_display')));
        $b->fontBody = self::fontName(Str::clean($p('font_body')));
        $b->logo = self::firstImage($p('logo'));
        $b->logoTransparent = self::firstImage($p('logo_transparent'));
        $b->favicon = self::firstImage($p('favicon'));
        $b->hero = self::firstImage($p('hero'));
        $b->teamPhoto = self::firstImage($p('team_photo'));
        foreach (FieldMap::candidates('brand', 'images') as $imgField) {
            $img = self::firstImage($f[$imgField] ?? null);
            if ($img !== '') {
                $b->images[] = $img;
            }
        }
        $b->phone = Str::clean($p('phone'));
        $b->email = Str::clean($p('email'));
        $b->web = Str::clean($p('web'));
        $b->webDomain = self::domain($b->web);
        $b->emergencyPhone = Str::clean($p('emergency_phone'));
        $b->oohLink = Str::clean($p('ooh_link'));
        $b->oohEmail = Str::clean($p('ooh_email'));
        $b->hasPhysicalAddress = Arr::truthy($p('physical'));
        $b->addressLines = array_values(array_filter([
            Str::clean($p('address1')), Str::clean($p('address2')), Str::clean($p('town')), Str::clean($p('postcode')), Str::clean($p('country')),
        ]));
        $b->mapsLink = Str::clean($p('maps_link'));
        $b->hours = Str::richText(Str::clean($p('hours')));
        if (stripos($b->hours, 'insert') !== false) {
            $b->hours = '';
        }
        foreach (['instagram', 'facebook', 'linkedin', 'x'] as $s) {
            $v = Str::clean($p($s));
            if ($v !== '') {
                if ($s === 'instagram' && !str_starts_with($v, 'http')) {
                    $v = 'https://instagram.com/' . ltrim($v, '@');
                }
                $b->social[$s] = $v;
            }
        }
        $b->trustpilot = Str::clean($p('trustpilot'));
        $b->googleReviews = Str::clean($p('google_reviews'));
        $b->displayLogos = Arr::strings($p('display_logos'));
        $b->privacyUrl = self::firstFile($p('privacy'));
        $b->complaintsUrl = self::firstFile($p('complaints'));
        foreach (Arr::images($p('footer_images')) as $img) {
            $b->footerImages[] = $img['url'];
        }
        $b->footerContent = Str::richText(Str::clean($p('footer_content')));
        foreach (['tpl_important' => 'important', 'tpl_insurance' => 'insurance', 'tpl_travel_aware' => 'travel_aware', 'tpl_correct_names' => 'correct_names', 'tpl_total_price' => 'total_price', 'tpl_financial' => 'financial', 'tpl_terms' => 'terms', 'tpl_flight' => 'flight', 'tpl_ptr' => 'ptr', 'tpl_quotation' => 'quotation'] as $k => $key) {
            $html = Str::richText(Str::clean($p($k)));
            if ($html !== '') {
                $b->templates[$key] = $html;
            }
        }
        for ($i = 1; $i <= 4; $i++) {
            $title = Str::clean($p('reason' . $i));
            if ($title !== '') {
                $b->reasons[] = ['title' => $title, 'text' => Str::richText(Str::clean($p('reason' . $i . '_ext')))];
            }
        }
        $b->trustAccountName = Str::clean($p('trust_name'));
        $b->trustSortCode = Str::clean($p('trust_sort'));
        $b->trustAccountNumber = Str::clean($p('trust_number'));
        $b->mintAllowCustom = Arr::truthy($p('mint_allow_custom'));
        $b->mintMethods = array_values(array_filter(array_map(static fn ($x) => strtoupper(trim($x)), Arr::strings($p('mint_methods')))));
        $b->mintWebhook = Str::clean($p('mint_webhook'));
        $b->mintApiKey = Str::clean($p('mint_api_key'));
        $b->mintBusinessUnit = Str::clean($p('mint_business_unit'));
        $b->mintConfigured = $b->mintApiKey !== '' && $b->mintBusinessUnit !== '';
        $b->proposition = Str::clean($p('proposition')) ?: Str::clean($pm('proposition'));

        $b->memberCompany = Str::clean($pm('company'));
        $b->memberNumber = Str::clean($pm('number'));
        $b->memberRegNo = Str::clean($pm('reg_no'));
        $b->memberVatNo = Arr::truthy($pm('vat_registered')) || Str::clean($pm('vat_no')) !== '' ? Str::clean($pm('vat_no')) : '';
        $b->memberOffice = array_values(array_filter([
            Str::clean($pm('office1')), Str::clean($pm('office2')), Str::clean($pm('office_town')), Str::clean($pm('office_postcode')),
        ]));
        $b->memberCountry = Str::clean($pm('office_country'));
        $b->memberProposition = Str::clean($pm('proposition'));
        $b->memberTAtolEnabled = Arr::truthy($pm('t_atol_enabled'));
        $b->memberTAtolNumber = Str::clean($pm('t_atol_number'));
        $b->memberDisclaimer = Str::richText(Str::clean($pm('disclaimer')));
        if ($b->name === '') {
            $b->name = $b->memberCompany ?: 'Your travel company';
        }
        return $b;
    }

    /** @return array{key:string,unit:string} */
    public function mintCredentials(): array
    {
        return ['key' => $this->mintApiKey, 'unit' => $this->mintBusinessUnit];
    }

    public function propositionKey(): string
    {
        $n = strtolower(trim($this->memberProposition ?: $this->proposition));
        return match (true) {
            str_contains($n, 'worldchoice plus') || str_contains($n, 'wc plus') => 'worldchoice_plus',
            str_contains($n, 'worldchoice') || str_contains($n, 'ttng') => 'worldchoice',
            str_contains($n, 'travel trust') || $n === 'tta' => 'tta',
            str_contains($n, 'global') => 'global',
            str_contains($n, 'independent travel') || $n === 'ite' => 'ite',
            default => '',
        };
    }

    public function propositionLabel(): string
    {
        return match ($this->propositionKey()) {
            'worldchoice_plus' => 'Worldchoice Plus',
            'worldchoice' => 'Worldchoice',
            'tta' => 'Travel Trust Association',
            'global' => 'The Global Travel Group',
            'ite' => 'Independent Travel Experts',
            default => $this->memberProposition ?: $this->proposition,
        };
    }

    public function legalLine(): string
    {
        $parts = [];
        if ($this->memberCompany !== '') {
            $parts[] = $this->memberCompany . ($this->memberNumber !== '' ? ' (member ' . $this->memberNumber . ')' : '');
        }
        if ($this->memberRegNo !== '') {
            $parts[] = 'Company no. ' . $this->memberRegNo;
        }
        if ($this->memberVatNo !== '') {
            $parts[] = 'VAT no. ' . $this->memberVatNo;
        }
        if ($this->memberOffice) {
            $parts[] = 'Registered office: ' . implode(', ', $this->memberOffice);
        }
        return implode(' · ', $parts);
    }

    private static function hex(string $v): string
    {
        $v = trim($v);
        return preg_match('/^#?([0-9A-Fa-f]{6})$/', $v, $m) ? '#' . strtoupper($m[1]) : '';
    }

    private static function fontName(string $v): string
    {
        $v = trim($v);
        return preg_match('/^[A-Za-z0-9 ]{2,40}$/', $v) ? $v : '';
    }

    private static function firstImage(mixed $value): string
    {
        $imgs = Arr::images($value);
        return $imgs[0]['url'] ?? '';
    }

    private static function firstFile(mixed $value): string
    {
        $atts = Arr::attachments($value);
        return (string) ($atts[0]['url'] ?? '');
    }

    private static function domain(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if (stripos($url, 'http') !== 0) {
            $url = 'https://' . $url;
        }
        $host = (string) parse_url($url, PHP_URL_HOST);
        return (string) preg_replace('/^www\./i', '', $host);
    }

    public function webUrl(): string
    {
        if ($this->web === '') {
            return '';
        }
        return stripos($this->web, 'http') === 0 ? $this->web : 'https://' . $this->web;
    }
}
