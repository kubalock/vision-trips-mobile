<?php
declare(strict_types=1);

namespace VisionTrips\Frontend;

use VisionTrips\Domain\Theme;
use VisionTrips\Domain\Trip;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Support\Str;

/**
 * The verification step. Designed to feel like part of the brand, not a wall: one question, big inputs, clear why.
 */
final class Gate
{
    private string $error = '';
    private string $otpSentTo = '';

    public function __construct(private Trip $trip, private string $token)
    {
    }

    public function handlePost(): void
    {
        $nonce = (string) ($_POST['_vt'] ?? '');
        if (!wp_verify_nonce($nonce, 'vt_gate_' . $this->trip->id)) {
            $this->error = 'That form has expired. Please try again.';
            return;
        }
        $action = (string) ($_POST['vt_action'] ?? '');
        if ($action === 'knowledge') {
            $method = (string) ($_POST['method'] ?? '');
            $input = array_map(static fn ($v) => is_string($v) ? trim($v) : '', $_POST);
            if (!Access::verifyKnowledge($this->trip, $method, $input)) {
                $this->error = 'Those details do not match our records. Check and try again, or verify by email instead.';
            } else {
                wp_safe_redirect(Token::url($this->token) . ($this->currentSubPath()), 303);
                exit;
            }
        } elseif ($action === 'otp_send') {
            $masked = Access::sendOtp($this->trip);
            if ($masked === '') {
                $this->error = 'We could not send a code right now. Please try again shortly or contact us.';
            } else {
                $this->otpSentTo = $masked;
            }
        } elseif ($action === 'otp_verify') {
            if (Access::verifyOtp($this->trip, (string) ($_POST['code'] ?? ''))) {
                wp_safe_redirect(Token::url($this->token) . $this->currentSubPath(), 303);
                exit;
            }
            $this->error = 'That code is not right or has expired.';
            $this->otpSentTo = Str::maskEmail($this->trip->customerEmail);
        }
    }

    private function currentSubPath(): string
    {
        $view = (string) get_query_var('vision_view');
        $doc = (string) get_query_var('vision_doc');
        $arg = (string) get_query_var('vision_arg');
        if ($view === '') {
            return '';
        }
        return trim($view . '/' . $doc . '/' . $arg, '/') . '/';
    }

    public function render(int $required): string
    {
        $trip = $this->trip;
        $options = Access::challengeOptions($trip);
        if ($required >= Access::LEVEL_OTP) {
            $options = in_array('otp', $options, true) ? ['otp'] : [];
        }
        $spec = Theme::spec($trip->theme);
        return View::render('gate/page', [
            'trip'     => $trip,
            'brand'    => $trip->brand,
            'options'  => $options,
            'error'    => $this->error,
            'otpSentTo' => $this->otpSentTo,
            'required' => $required,
            'nonce'    => wp_create_nonce('vt_gate_' . $trip->id),
            'accent'   => $trip->brand->colour !== '' ? $trip->brand->colour : '#1F4F6E',
            'fontsUrl' => Theme::fontsUrl($trip->theme, $trip->brand->fontDisplay, $trip->brand->fontBody),
            'displayFont' => $trip->brand->fontDisplay !== '' ? $trip->brand->fontDisplay : $spec['family'],
            'bodyFont' => $trip->brand->fontBody !== '' ? $trip->brand->fontBody : 'Instrument Sans',
            'theme'    => $trip->theme,
            'spec'     => $spec,
            'maskedEmail' => Str::maskEmail($trip->customerEmail),
        ]);
    }
}
