<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Local copies of images that come from Airtable attachments. Airtable attachment URLs expire within hours, so a
 * page served from a saved copy — or simply left open — can end up with broken pictures. The first render shows the
 * Airtable URL and queues a background download keyed by the attachment id; every later render serves the local file.
 */
final class Assets
{
    /** @return array{dir:string,url:string}|null */
    private static function store(): ?array
    {
        if (!function_exists('wp_upload_dir')) {
            return null;
        }
        $u = wp_upload_dir();
        if (!empty($u['error'])) {
            return null;
        }
        return ['dir' => trailingslashit($u['basedir']) . 'vision-trips/attachments/', 'url' => trailingslashit($u['baseurl']) . 'vision-trips/attachments/'];
    }

    /** The URL to show now for an Airtable attachment image (local when cached; the Airtable URL meanwhile). */
    public static function image(string $url, string $attachmentId = ''): string
    {
        if ($url === '' || !preg_match('#^https://[a-z0-9.-]*airtable(usercontent)?\.com/#i', $url)) {
            return $url;
        }
        $store = self::store();
        if ($store === null) {
            return $url;
        }
        $key = $attachmentId !== '' ? $attachmentId : md5((string) preg_replace('#\?.*$#', '', $url));
        foreach (['jpg', 'png', 'webp', 'gif'] as $ext) {
            $file = $store['dir'] . $key . '.' . $ext;
            if (is_file($file)) {
                return $store['url'] . $key . '.' . $ext;
            }
        }
        // Not on disk yet: link to our own image endpoint, which fetches on first request, stores and streams.
        // The Airtable URL is remembered for 30 days so the fetch works long after the original link expired.
        set_transient('vtr_img_' . $key, $url, 30 * DAY_IN_SECONDS);
        $ext = preg_match('/\.(png|webp|gif)(\?|$)/i', $url, $m) ? strtolower($m[1]) : 'jpg';
        return home_url('/' . trim((string) \VisionTrips\Settings::get('trip_page_slug', 'trip'), '/') . '/img/' . $key . '.' . $ext . '?k=' . self::sig($key));
    }

    private static function sig(string $key): string
    {
        return substr(hash_hmac('sha256', 'img|' . $key, (string) \VisionTrips\Settings::get('link_secret', '')), 0, 12);
    }

    /** /trip/img/{key}.{ext} — serve from disk, or fetch the Airtable attachment once, store and serve. Never returns. */
    public static function serve(string $key, string $ext, string $sig): never
    {
        $key = (string) preg_replace('/[^A-Za-z0-9_-]/', '', $key);
        if ($key === '' || !hash_equals(self::sig($key), $sig)) {
            status_header(404);
            exit;
        }
        $store = self::store();
        $file = '';
        if ($store) {
            foreach (['jpg', 'png', 'webp', 'gif'] as $e) {
                if (is_file($store['dir'] . $key . '.' . $e)) {
                    $file = $store['dir'] . $key . '.' . $e;
                    break;
                }
            }
            if ($file === '') {
                $url = (string) get_transient('vtr_img_' . $key);
                if ($url !== '' && self::fetch(['url' => $url, 'key' => $key])) {
                    foreach (['jpg', 'png', 'webp', 'gif'] as $e) {
                        if (is_file($store['dir'] . $key . '.' . $e)) {
                            $file = $store['dir'] . $key . '.' . $e;
                            break;
                        }
                    }
                }
            }
        }
        if ($file === '') {
            status_header(404);
            header('Cache-Control: no-store');
            exit;
        }
        $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];
        self::stream($file, $types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'image/jpeg', 2592000);
    }

    /**
     * Stream a file to the browser exactly as it is on disk. Output buffers (WordPress, plugins, PHP) are discarded,
     * zlib compression is turned off, and Content-Length is sent only when PHP cannot change the byte count —
     * a mismatch there is what makes progressive JPEGs render as a strip and then stall.
     */
    public static function stream(string $file, string $type, int $maxAge): never
    {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        @ini_set('zlib.output_compression', '0');
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        $etag = '"' . md5((string) filemtime($file) . (string) filesize($file) . basename($file)) . '"';
        if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
            status_header(304);
            header('ETag: ' . $etag);
            exit;
        }
        status_header(200);
        header('Content-Type: ' . $type);
        header('Cache-Control: public, max-age=' . $maxAge . ', immutable');
        header('ETag: ' . $etag);
        header('X-Robots-Tag: noindex');
        header('Accept-Ranges: none');
        if (!ini_get('zlib.output_compression')) {
            header('Content-Length: ' . (string) filesize($file));
        }
        $fh = @fopen($file, 'rb');
        if ($fh) {
            while (!feof($fh)) {
                echo fread($fh, 65536);
                flush();
            }
            fclose($fh);
        }
        exit;
    }

    /** Background or on-demand: download one attachment image into uploads. @param array<string,mixed> $args */
    public static function fetch(array $args): bool
    {
        $store = self::store();
        $url = (string) ($args['url'] ?? '');
        $key = (string) preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($args['key'] ?? ''));
        if ($store === null || $url === '' || $key === '') {
            return false;
        }
        if (!is_dir($store['dir'])) {
            wp_mkdir_p($store['dir']);
        }
        $res = wp_remote_get($url, ['timeout' => 20, 'redirection' => 3]);
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            return false;
        }
        $type = (string) wp_remote_retrieve_header($res, 'content-type');
        $ext = match (true) {
            str_contains($type, 'png') => 'png',
            str_contains($type, 'webp') => 'webp',
            str_contains($type, 'gif') => 'gif',
            str_contains($type, 'jpeg') || str_contains($type, 'jpg') => 'jpg',
            default => '',
        };
        $body = (string) wp_remote_retrieve_body($res);
        if ($ext === '' || $body === '' || strlen($body) > 8 * 1024 * 1024) {
            return false;
        }
        return @file_put_contents($store['dir'] . $key . '.' . $ext, $body) !== false;
    }
}
