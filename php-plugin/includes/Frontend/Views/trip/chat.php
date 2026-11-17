<?php
namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;

/** The trip concierge: a floating button and a chat sheet. Suggested questions change with the stage. */
/** @var \VisionTrips\Domain\Trip $trip */
$who = $trip->agentName !== '' ? \VisionTrips\Support\Str::firstName($trip->agentName) : $brand->name;
$suggest = match ($trip->stage) {
    Stage::QUOTE => ['What exactly is included?', 'How do I accept and pay the deposit?', 'Can I change the dates?', 'How is my money protected?'],
    Stage::CONFIRMED, Stage::COUNTDOWN => ['When is my balance due?', 'When will I get my tickets?', 'Can I add transfers or an upgrade?'],
    Stage::PREP => ['What time should I be at the airport?', 'What documents do I need to take?', 'Who do I call if something goes wrong?'],
    Stage::DEPARTURE, Stage::TRAVELLING, Stage::RETURNING => ['Where is my transfer meeting point?', 'What time is check-out?', 'What is the out-of-hours number?'],
    default => ['Can you help me plan my next trip?', 'How do I leave a review?', 'Can I see my documents?'],
};
// Data-driven extras: the questions people actually ask about what is on this booking
if ($trip->hasKind('flight')) {
    $suggest[] = 'What is my baggage allowance?';
    $suggest[] = 'How does online check-in work?';
}
if ($trip->hasKind('cruise')) {
    $suggest[] = 'What is the dress code on board?';
    $suggest[] = 'What time do we embark?';
}
if ($trip->hasKind('stay')) {
    $suggest[] = 'What time is hotel check-in?';
}
if ($trip->countries) {
    $suggest[] = 'What currency do I need in ' . $trip->countries[0] . '?';
    $suggest[] = 'Do I need a visa for ' . $trip->countries[0] . '?';
    $suggest[] = 'What plug adaptor do I need?';
}
$suggest = array_values(array_unique($suggest));
?>
<button type="button" class="vt-chat__fab" data-chat-open aria-controls="vt-chat" aria-expanded="false"><?= icon('help') ?><span>Ask about my trip</span></button>
<section class="vt-chat" id="vt-chat" hidden aria-label="Ask about your trip" data-chat data-agent="<?= e($who) ?>">
  <header class="vt-chat__head">
    <div class="vt-chat__who"><span class="vt-chat__avatar" aria-hidden="true"><?= e(mb_strtoupper(mb_substr($brand->name, 0, 1))) ?></span><div><strong>Ask about your trip</strong><span>Answers from your booking in seconds, researched when needed — anything we can't answer goes straight to <?= e($who) ?>.</span></div></div>
    <button type="button" class="vt-iconbtn" data-chat-close aria-label="Close"><?= icon('close') ?></button>
  </header>
  <div class="vt-chat__log" data-chat-log role="log" aria-live="polite">
    <div class="vt-chat__msg is-bot"><p>Hello<?= $trip->leadFirstName() !== '' ? ' ' . e($trip->leadFirstName()) : '' ?>. Ask me anything about this trip — times, documents, payments, what's included. If it needs <?= e($who) ?>, I'll pass it on and let you know.</p></div>
  </div>
  <div class="vt-chat__suggest" data-chat-suggest>
    <?php foreach ($suggest as $q): ?><button type="button" class="vt-chip" data-chat-q="<?= e($q) ?>"><?= e($q) ?></button><?php endforeach; ?>
  </div>
  <form class="vt-chat__form" data-chat-form>
    <label class="vt-sr" for="vt-chat-input">Your question</label>
    <input id="vt-chat-input" type="text" name="q" maxlength="600" autocomplete="off" placeholder="Type a question…" required>
    <button type="submit" class="vt-btn vt-btn--primary vt-btn--sm" aria-label="Send"><?= icon('arrow') ?></button>
  </form>
  <p class="vt-chat__foot">A digital assistant answers from your booking; a person at <?= e($brand->name) ?> is always a message away. Nothing here changes your booking.</p>
</section>
