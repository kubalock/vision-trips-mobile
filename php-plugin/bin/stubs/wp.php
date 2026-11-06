<?php
/**
 * Minimal WordPress function stubs so the plugin's templates can be rendered and tested outside WordPress.
 * Not a WordPress replacement — just enough surface for the frontend code paths.
 */
declare(strict_types=1);

if (!defined('ABSPATH')) {
    define('ABSPATH', '/tmp/');
}
if (!defined('MINUTE_IN_SECONDS')) {
    define('MINUTE_IN_SECONDS', 60);
    define('HOUR_IN_SECONDS', 3600);
    define('DAY_IN_SECONDS', 86400);
    define('WEEK_IN_SECONDS', 604800);
}
$GLOBALS['vt_options'] = [];
$GLOBALS['vt_transients'] = [];
$GLOBALS['vt_home'] = 'https://my-trip.co.uk';

function get_option(string $k, mixed $d = false): mixed { return $GLOBALS['vt_options'][$k] ?? $d; }
function update_option(string $k, mixed $v, mixed $autoload = null): bool { $GLOBALS['vt_options'][$k] = $v; return true; }
function delete_option(string $k): bool { unset($GLOBALS['vt_options'][$k]); return true; }
function get_transient(string $k): mixed { return $GLOBALS['vt_transients'][$k] ?? false; }
function set_transient(string $k, mixed $v, int $ttl = 0): bool { $GLOBALS['vt_transients'][$k] = $v; return true; }
function delete_transient(string $k): bool { unset($GLOBALS['vt_transients'][$k]); return true; }
function add_action(...$a): void {}
function add_filter(...$a): void {}
function remove_action(...$a): bool { return true; }
function remove_filter(...$a): bool { return true; }
function do_action(...$a): void {}
function apply_filters(string $hook, mixed $value, ...$args): mixed { return $value; }
function add_shortcode(...$a): void {}
function add_rewrite_rule(...$a): void {}
function register_rest_route(...$a): void {}
function esc_html(mixed $t): string { return htmlspecialchars((string) $t, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr(mixed $t): string { return esc_html($t); }
function esc_textarea(mixed $t): string { return esc_html($t); }
function esc_js(mixed $t): string { return addslashes((string) $t); }
function esc_url(mixed $u): string { return (string) $u; }
function esc_url_raw(mixed $u): string { return (string) $u; }
function wp_strip_all_tags(mixed $s, bool $breaks = false): string { return trim(strip_tags((string) $s)); }
function sanitize_text_field(mixed $s): string { return trim(strip_tags((string) $s)); }
function sanitize_textarea_field(mixed $s): string { return trim(strip_tags((string) $s)); }
function sanitize_key(mixed $s): string { return strtolower((string) preg_replace('/[^a-z0-9_\-]/i', '', (string) $s)); }
function sanitize_file_name(mixed $s): string { return (string) preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $s); }
function sanitize_html_class(mixed $s): string { return (string) preg_replace('/[^A-Za-z0-9_-]/', '', (string) $s); }
function remove_accents(string $s): string { $c = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s); return is_string($c) && $c !== '' ? $c : $s; }
function wp_kses(string $html, array $allowed): string {
    $tags = '<' . implode('><', array_keys($allowed)) . '>';
    $html = strip_tags($html, $tags);
    return (string) preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
}
function wp_kses_post(string $html): string { return strip_tags($html, '<a><p><br><strong><b><em><i><u><ul><ol><li><h3><h4><h5><h6><code><span>'); }
function wp_json_encode(mixed $d, int $o = 0, int $depth = 512): string|false { return json_encode($d, $o, $depth); }
function home_url(string $p = ''): string { return $GLOBALS['vt_home'] . $p; }
function rest_url(string $p = ''): string { return $GLOBALS['vt_home'] . '/wp-json/' . ltrim($p, '/'); }
function admin_url(string $p = ''): string { return $GLOBALS['vt_home'] . '/wp-admin/' . $p; }
function add_query_arg(mixed $k, mixed $v = null, ?string $url = null): string { if (is_array($k)) { $url = (string) $v; $args = $k; } else { $args = [$k => $v]; } $sep = str_contains((string) $url, '?') ? '&' : '?'; return $url . $sep . http_build_query($args); }
function wp_create_nonce(string $a = ''): string { return 'nonce-' . substr(md5($a), 0, 8); }
function wp_verify_nonce(string $n, string $a = ''): bool { return $n === wp_create_nonce($a); }
function wp_nonce_field(...$a): string { return ''; }
function is_ssl(): bool { return true; }
function wp_timezone(): DateTimeZone { return new DateTimeZone('Europe/London'); }
function is_email(mixed $e): bool { return (bool) filter_var((string) $e, FILTER_VALIDATE_EMAIL); }
function wp_mail(...$a): bool { $GLOBALS['vt_mail'][] = $a; return true; }
function wp_http_validate_url(string $u): string|false { return filter_var($u, FILTER_VALIDATE_URL) ? $u : false; }
function nocache_headers(): void {}
function status_header(int $c): void {}
function current_user_can(string $c): bool { return true; }
function get_bloginfo(string $k = ''): string { return 'My Trip'; }
function wp_safe_redirect(string $u, int $s = 302): bool { return true; }
function checked(mixed $a, mixed $b = true, bool $echo = true): string { return $a == $b ? ' checked' : ''; }
function selected(mixed $a, mixed $b = true, bool $echo = true): string { return $a == $b ? ' selected' : ''; }
function get_query_var(string $k): string { return $GLOBALS['vt_query'][$k] ?? ''; }
function is_wp_error(mixed $t): bool { return $t instanceof WP_Error; }
/** Tests can install a fake transport: $GLOBALS['vt_http_handler'] = fn(string $method, string $url, array $args) => ['code' => 200, 'body' => '...']|null */
function vt_fake_http(string $method, string $url, array $args): mixed {
    $h = $GLOBALS['vt_http_handler'] ?? null;
    if ($h) { $r = $h($method, $url, $args); if (is_array($r)) { return ['response' => ['code' => $r['code']], 'body' => $r['body'], 'headers' => $r['headers'] ?? []]; } }
    return new WP_Error('offline', 'HTTP disabled in preview');
}
function wp_remote_get(string $url, array $args = []): mixed { return vt_fake_http('GET', $url, $args); }
function wp_remote_request(string $url, array $args = []): mixed { return vt_fake_http(strtoupper((string) ($args['method'] ?? 'GET')), $url, $args); }
function wp_remote_post(string $url, array $args = []): mixed { return vt_fake_http('POST', $url, $args); }
function wp_remote_retrieve_header(mixed $r, string $k): string { return is_array($r) ? (string) ($r['headers'][$k] ?? '') : ''; }
function wp_schedule_single_event(...$a): bool { return true; }
function spawn_cron(): void {}
function wp_next_scheduled(...$a): bool { return false; }
function wp_schedule_event(...$a): bool { return true; }
function wp_clear_scheduled_hook(...$a): int { return 0; }
function get_current_user_id(): int { return 1; }
function is_user_logged_in(): bool { return false; }
function wp_remote_retrieve_response_code(mixed $r): int { return is_array($r) ? (int) ($r['response']['code'] ?? 0) : 0; }
function wp_remote_retrieve_body(mixed $r): string { return is_array($r) ? (string) ($r['body'] ?? '') : ''; }
function wp_unslash(mixed $v): mixed { return $v; }
function __(string $s, string $d = ''): string { return $s; }

class WP_Error {
    public function __construct(private string $code = '', private string $message = '', private mixed $data = null) {}
    public function get_error_message(): string { return $this->message; }
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): mixed { return $this->data; }
}
class WP_REST_Request implements ArrayAccess {
    private array $params = [];
    private array $headers = [];
    public function __construct(array $params = [], array $headers = []) { $this->params = $params; $this->headers = $headers; }
    public function get_param(string $k): mixed { return $this->params[$k] ?? null; }
    public function get_header(string $k): string { return $this->headers[strtolower($k)] ?? ''; }
    public function offsetExists(mixed $o): bool { return isset($this->params[$o]); }
    public function offsetGet(mixed $o): mixed { return $this->params[$o] ?? null; }
    public function offsetSet(mixed $o, mixed $v): void { $this->params[$o] = $v; }
    public function offsetUnset(mixed $o): void { unset($this->params[$o]); }
}
class WP_REST_Response { public function __construct(public mixed $data = null, public int $status = 200) {} public function header(string $k, string $v): void {} }
