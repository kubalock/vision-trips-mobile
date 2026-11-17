<?php
namespace VisionTrips\Frontend;

/**
 * The site's front page: the way into every trip this site serves. No member context yet, so it is deliberately
 * neutral — the member's brand takes over the moment a trip is opened.
 */
$notFound = isset($_GET['notfound']);
$prefill = isset($_GET['email']) ? sanitize_email((string) wp_unslash($_GET['email'])) : '';
$prefillRef = isset($_GET['ref']) ? strtoupper(sanitize_text_field((string) wp_unslash($_GET['ref']))) : '';
$find = !empty($find);
$hex = ltrim($accent, '#');
$hex = strlen($hex) === 3 ? $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2] : $hex;
[$r, $g, $b] = strlen($hex) === 6 ? array_map('hexdec', str_split($hex, 2)) : [31, 79, 110];
$ink = (0.2126 * $r + 0.7152 * $g + 0.0722 * $b) > 160 ? '#111111' : '#ffffff';
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex">
<title><?= e($name) ?> — find your trip</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600;700&display=swap">
<style>
:root { --accent: <?= e($accent) ?>; --ink: #1B1D1F; --ink-2: #4A4F55; --ink-3: #7A8088; --surface: #fff; --bg: #F4F4F1; --line: #E4E3DE; --accent-ink: <?= e($ink) ?>; }
@media (prefers-color-scheme: dark) { :root { --ink: #ECEAE4; --ink-2: #B8BCC2; --ink-3: #8A9098; --surface: #1B1E20; --bg: #121415; --line: #2C3135; } }
* { box-sizing: border-box; } body { margin: 0; font-family: 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.55; }
.hero { background: radial-gradient(120% 90% at 10% 0%, color-mix(in srgb, var(--accent) 85%, #000 15%) 0%, var(--accent) 55%, color-mix(in srgb, var(--accent) 70%, #000 30%) 100%); color: var(--accent-ink); padding: calc(28px + env(safe-area-inset-top, 0px)) 0 56px; }
.wrap { width: min(1040px, 100% - 40px); margin: 0 auto; }
.brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: 0.01em; }
.brand img { height: 44px; width: auto; }
h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: clamp(2rem, 6vw, 3.6rem); line-height: 1.05; margin: 40px 0 14px; max-width: 14ch; }
.intro { font-size: 1.1rem; max-width: 56ch; opacity: 0.92; margin: 0 0 26px; }
.find { background: var(--surface); color: var(--ink); border-radius: 22px; padding: 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.25); max-width: 560px; }
.find h2 { margin: 0 0 4px; font-size: 1.1rem; } .find p { margin: 0 0 14px; color: var(--ink-2); font-size: 0.95rem; }
.row { display: flex; gap: 8px; flex-wrap: wrap; } .row + .row { margin-top: 8px; } .row input { flex: 1 1 220px; font: inherit; font-size: 16px; padding: 14px 16px; border: 1.5px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink); min-height: 50px; }
.row input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.btn { font: inherit; font-weight: 700; padding: 0 22px; min-height: 50px; border-radius: 999px; border: 0; background: var(--accent); color: var(--accent-ink); cursor: pointer; }
.hint { font-size: 0.85rem; color: var(--ink-3); margin: 12px 0 0; }
.err { background: #FBEAEA; color: #8B1E1E; border-radius: 12px; padding: 10px 14px; font-size: 0.95rem; margin: 0 0 14px; }
.points { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: -28px auto 40px; }
.point { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 18px; display: grid; gap: 6px; box-shadow: 0 8px 30px rgba(0,0,0,0.06); }
.point strong { font-size: 1rem; } .point span { color: var(--ink-2); font-size: 0.95rem; }
.point svg { width: 28px; height: 28px; color: var(--accent); }
footer { padding: 24px 0 calc(32px + env(safe-area-inset-bottom, 0px)); color: var(--ink-3); font-size: 0.85rem; display: flex; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
footer a { color: inherit; }
.powered { text-align: center; font-size: 0.75rem; color: var(--ink-3); margin: -8px 0 28px; } .powered a { color: inherit; }
</style>
</head>
<body>
<section class="hero">
  <div class="wrap">
    <div class="brand"><?php if ($logo !== ''): ?><img src="<?= e($logo) ?>" alt="<?= e($name) ?>"><?php else: ?><?= e($name) ?><?php endif; ?></div>
    <h1><?= e($title) ?></h1>
    <p class="intro"><?= e($intro) ?></p>
    <div class="find">
      <?php if ($find): ?>
      <h2>Find my trip</h2>
      <p>Enter your booking reference and the email address you booked with, and we'll send you a one-time code.</p>
      <?php if ($notFound): ?><p class="err">We couldn't match that reference and email. Check both against your travel agent's email, or open the link they sent you.</p><?php endif; ?>
      <form method="get" action="<?= e($portal) ?>">
        <div class="row"><input type="text" name="ref" value="<?= e($prefillRef) ?>" placeholder="Booking reference, e.g. NWG-X0333-1234567A" autocomplete="off" autocapitalize="characters" required aria-label="Booking reference"></div>
        <div class="row"><input type="email" name="email" value="<?= e($prefill) ?>" placeholder="you@example.com" autocomplete="email" required aria-label="Email address"><button class="btn" type="submit">Email me a code</button></div>
      </form>
      <p class="hint">Your reference is at the top of every email about your trip. Already have the link? Open it from your travel agent's email or text — it takes you straight there.</p>
      <?php else: ?>
      <h2>Your trip is a tap away</h2>
      <p>Open the link your travel agent sent you by email or text message — it takes you straight to your trip, with everything kept up to date.</p>
      <p class="hint">Can't find it? Your travel agent can send it again in seconds.</p>
      <?php endif; ?>
    </div>
  </div>
</section>
<div class="wrap">
  <div class="points">
    <div class="point"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg><strong>Private and secure</strong><span>Your trip is only ever shown to you, after a quick check it's really you.</span></div>
    <div class="point"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 2v4M16 2v4M4 10h16"/></svg><strong>Always up to date</strong><span>Itinerary, documents, payments and live flight status — the same place, every time.</span></div>
    <div class="point"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/></svg><strong>A person, always</strong><span>Your travel agent is one message away, before you go and while you're there.</span></div>
  </div>
  <footer>
    <span><?= e($name) ?><?= $phone !== '' ? ' · ' . e($phone) : '' ?><?= $email !== '' ? ' · <a href="mailto:' . e($email) . '">' . e($email) . '</a>' : '' ?></span>
    <span><a href="<?= e(home_url('/' . trim((string) \VisionTrips\Settings::get('trip_page_slug', 'trip'), '/') . '/accessibility/')) ?>">Accessibility</a></span>
  </footer>
  <p class="powered">Powered by <a href="https://thetravelnetworkgroup.co.uk" rel="noopener" target="_blank">Vision</a> from The Travel Network Group</p>
</div>
</body>
</html>
