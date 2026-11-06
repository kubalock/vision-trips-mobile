<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Domain\Brand;
use VisionTrips\Support\Log;

/**
 * Branded HTML email in the member's identity: logo on a white plate, accent colour, one clear button, legal footer.
 * Table-based, inline styles, 600px, so it renders in Outlook, Gmail and Apple Mail. A plain-text part is sent too.
 * Airtable attachment URLs expire, so the logo is copied into the uploads folder once and served from there.
 */
final class Email
{
    /**
     * @param array<int,array{label:string,url:string}> $buttons
     * @param array<int,array{label:string,value:string}> $facts  key/value rows under the heading
     */
    public static function send(Brand $brand, string $to, string $subject, string $heading, string $bodyHtml, array $buttons = [], array $facts = [], string $preheader = ''): bool
    {
        $to = trim($to);
        if ($to === '' || !is_email($to)) {
            return false;
        }
        $html = self::render($brand, $subject, $heading, $bodyHtml, $buttons, $facts, $preheader);
        $text = self::plain($brand, $heading, $bodyHtml, $buttons, $facts);
        // wp_mail builds the MIME message itself: give it HTML, and attach the plain-text part via PHPMailer.
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        if ($brand->email !== '' && is_email($brand->email)) {
            $headers[] = 'Reply-To: ' . str_replace(["\r", "\n", '<', '>'], '', $brand->name) . ' <' . $brand->email . '>';
        }
        $fromName = static fn (string $n) => $brand->name !== '' ? $brand->name : $n;
        $altBody = static function ($phpmailer) use ($text): void {
            $phpmailer->AltBody = $text;
            $phpmailer->CharSet = 'UTF-8';
        };
        add_filter('wp_mail_from_name', $fromName, 20);
        add_action('phpmailer_init', $altBody, 20);
        $sent = wp_mail($to, $subject, $html, $headers);
        remove_action('phpmailer_init', $altBody, 20);
        remove_filter('wp_mail_from_name', $fromName, 20);
        if (!$sent) {
            Log::error('Email failed', ['subject' => $subject]);
        }
        return $sent;
    }

    /** @param array<int,array{label:string,url:string}> $buttons @param array<int,array{label:string,value:string}> $facts */
    public static function render(Brand $brand, string $subject, string $heading, string $bodyHtml, array $buttons = [], array $facts = [], string $preheader = ''): string
    {
        $accent = $brand->colour !== '' ? $brand->colour : '#1F4F6E';
        $ink = \VisionTrips\Frontend\View::contrastInk($accent);
        $logo = self::localLogo($brand);
        $e = static fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $font = "font-family:'Instrument Sans','Helvetica Neue',Helvetica,Arial,sans-serif;";
        $h = '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>' . $e($subject) . '</title></head>';
        $h .= '<body style="margin:0;padding:0;background:#F2F2EF;' . $font . '">';
        if ($preheader !== '') {
            $h .= '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F2F2EF;">' . $e($preheader) . str_repeat('&nbsp;&zwnj;', 30) . '</div>';
        }
        $h .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2EF;"><tr><td align="center" style="padding:28px 12px;">';
        $h .= '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">';
        // Letterhead
        $h .= '<tr><td style="padding:0 0 18px;" align="left">';
        $h .= $logo !== '' ? '<img src="' . $e($logo) . '" alt="' . $e($brand->name) . '" style="max-height:48px;max-width:220px;height:auto;width:auto;display:block;background:#fff;border-radius:10px;padding:8px 12px;">' : '<span style="font-size:20px;font-weight:700;color:#1B1D1F;">' . $e($brand->name) . '</span>';
        $h .= '</td></tr>';
        // Card
        $h .= '<tr><td style="background:#ffffff;border-radius:20px;padding:0;overflow:hidden;">';
        $h .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:' . $e($accent) . ';font-size:0;line-height:0;">&nbsp;</td></tr>';
        $h .= '<tr><td style="padding:30px 32px 10px;"><h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;font-weight:700;color:#1B1D1F;' . $font . '">' . $e($heading) . '</h1>';
        $h .= '<div style="font-size:16px;line-height:1.6;color:#2E3338;">' . $bodyHtml . '</div></td></tr>';
        if ($facts) {
            $h .= '<tr><td style="padding:6px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 6px;">';
            foreach ($facts as $f) {
                $h .= '<tr><td style="padding:10px 14px;background:#F6F6F3;border-radius:10px;font-size:14px;color:#1B1D1F;"><span style="color:#6B7178;display:block;font-size:12px;">' . $e($f['label']) . '</span><strong>' . $e($f['value']) . '</strong></td></tr>';
            }
            $h .= '</table></td></tr>';
        }
        if ($buttons) {
            $h .= '<tr><td style="padding:10px 32px 30px;">';
            foreach ($buttons as $i => $b) {
                $primary = $i === 0;
                $h .= '<a href="' . $e($b['url']) . '" style="display:inline-block;margin:0 10px 10px 0;padding:14px 22px;border-radius:999px;font-weight:700;font-size:15px;text-decoration:none;' . ($primary ? 'background:' . $e($accent) . ';color:' . $e($ink) . ';' : 'background:#fff;color:#1B1D1F;border:1.5px solid #D3D2CC;') . '">' . $e($b['label']) . '</a>';
            }
            $h .= '</td></tr>';
        } else {
            $h .= '<tr><td style="padding:0 0 22px;"></td></tr>';
        }
        $h .= '</table></td></tr>';
        // Contact + legal
        $contact = array_filter([$brand->phone, $brand->email, $brand->webDomain]);
        $h .= '<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.6;color:#6B7178;">';
        $h .= '<strong style="color:#1B1D1F;">' . $e($brand->name) . '</strong>' . ($contact ? ' · ' . $e(implode(' · ', $contact)) : '') . '<br>';
        if ($brand->legalLine() !== '') {
            $h .= $e($brand->legalLine()) . '<br>';
        }
        if ($brand->privacyUrl !== '') {
            $h .= '<a href="' . $e($brand->privacyUrl) . '" style="color:#6B7178;">Privacy policy</a> · ';
        }
        $h .= 'You are receiving this because you have a trip or quotation with ' . $e($brand->name) . '.';
        $h .= '</td></tr></table></td></tr></table></body></html>';
        return $h;
    }

    /** @param array<int,array{label:string,url:string}> $buttons @param array<int,array{label:string,value:string}> $facts */
    private static function plain(Brand $brand, string $heading, string $bodyHtml, array $buttons, array $facts): string
    {
        $text = $heading . "\n\n" . trim(html_entity_decode(wp_strip_all_tags(str_replace(['</p>', '<br>', '<br/>', '<br />', '</li>'], ["\n\n", "\n", "\n", "\n", "\n"], $bodyHtml)), ENT_QUOTES, 'UTF-8'));
        foreach ($facts as $f) {
            $text .= "\n" . $f['label'] . ': ' . $f['value'];
        }
        foreach ($buttons as $b) {
            $text .= "\n\n" . $b['label'] . ': ' . $b['url'];
        }
        $text .= "\n\n" . $brand->name . (($brand->phone !== '') ? ' · ' . $brand->phone : '') . (($brand->email !== '') ? ' · ' . $brand->email : '');
        return $text;
    }

    /** A permanent copy of the member logo in uploads (Airtable attachment URLs expire within hours). */
    public static function localLogo(Brand $brand): string
    {
        $src = $brand->logo !== '' ? $brand->logo : $brand->logoTransparent;
        if ($src === '' || !function_exists('wp_upload_dir')) {
            return $src;
        }
        $key = 'logo-' . md5($brand->id . '|' . $brand->name);
        $uploads = wp_upload_dir();
        if (!empty($uploads['error'])) {
            return $src;
        }
        $dir = trailingslashit($uploads['basedir']) . 'vision-trips/';
        $url = trailingslashit($uploads['baseurl']) . 'vision-trips/';
        foreach (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as $ext) {
            $file = $dir . $key . '.' . $ext;
            if (is_file($file) && filemtime($file) > time() - 30 * DAY_IN_SECONDS) {
                return $url . $key . '.' . $ext;
            }
        }
        if (!is_dir($dir)) {
            wp_mkdir_p($dir);
        }
        $res = wp_remote_get($src, ['timeout' => 15]);
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            return $src;
        }
        $type = (string) wp_remote_retrieve_header($res, 'content-type');
        $ext = match (true) {
            str_contains($type, 'png') => 'png',
            str_contains($type, 'jpeg') || str_contains($type, 'jpg') => 'jpg',
            str_contains($type, 'gif') => 'gif',
            str_contains($type, 'webp') => 'webp',
            str_contains($type, 'svg') => 'svg',
            default => '',
        };
        if ($ext === '') {
            return $src;
        }
        $body = (string) wp_remote_retrieve_body($res);
        if ($body === '' || strlen($body) > 2 * 1024 * 1024) {
            return $src;
        }
        if ($ext === 'svg' && preg_match('/<script|on\w+\s*=|javascript:/i', $body)) {
            return $src; // never store an SVG with scripting
        }
        file_put_contents($dir . $key . '.' . $ext, $body);
        return $url . $key . '.' . $ext;
    }
}
