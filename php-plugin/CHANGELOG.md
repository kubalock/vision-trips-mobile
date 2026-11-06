# Vision Trips — changelog

Versions follow semantic versioning: features bump the minor, fixes the patch. Shown in wp-admin → Vision Trips → Changelog.

## 1.7.4 — 4 November 2026
### Fixed
- AeroDataBox's `EnRoute` (and other phases) fell through to "unknown" and were hidden — the flight was invisible while in the air.
### Added
- Full phase model for both providers: check-in open, on time, delayed (new time), go to gate (gate call), boarding, gate closed, departed, in the air (estimated arrival), approaching, landed (bag belt), cancelled, diverted. Every flight the airport systems know about is on the board with every detail they give: terminals, gates, belts, aircraft, changed times with the original struck through.

## 1.7.3 — 4 November 2026
### Changed
- The live flight board only shows flights with a genuine live status; a flight without data is simply not on the board (the itinerary already carries its times). Flight status and weather load quietly, with no placeholder that could vanish. "Not available" wording removed everywhere: empty states are neutral and forward-looking.

## 1.7.2 — 4 November 2026
### Changed
- **AI copy is written once per place and reused everywhere.** Hotel, ship and destination copy is cached by the place alone (name normalised — "Barceló Corralejo Bay - Adults Only" and "Barcelo Corralejo Bay" are one entry) for 90 days, shared across every booking and every member. Nothing booking-specific (tone, room, dates, traveller type) goes into the prompt or the key any more.
### Fixed
- Open/close chevrons were the only icons meant to rotate; the rule also caught the Sent tick, the acceptance ticks and the envelope icon.

## 1.7.1 — 4 November 2026
### Fixed
- **AI copy is brochure copy, nothing else.** A model "note to the travel professional" reached a quotation page. Every customer-facing generation now runs under a brochure-writer system prompt with a hard output contract; only the final copy inside `<copy>` tags is used (working notes are discarded unread); a validator rejects commentary, mentions of reviews/sources/rules, negativity, markdown, superlatives and URLs, and regenerates once — if still not clean, nothing is shown and the page falls back to the next source. Airline/airport guides get the same gate (plus "never book direct"). All AI copy written before this gate is regenerated automatically on update.

## 1.7.0 — 4 November 2026
### Added
- Flight board: manual **Refresh** (at most once every two minutes); server cache aligned to two minutes.
- Personalised message normaliser: strips a member's own greeting/sign-off (the page adds the designed "Hi {name}" and signature), turns single newlines into paragraphs, price/option lines into lists, folds very long notes behind "Read the full note".
- Changelog tab in wp-admin, version shown in the plugin header and admin.
### Fixed
- Element headings from Vision formulas ("Annabelle — 7 nights") no longer used verbatim as hotel names or Google Places queries.
- Widgety ship teaser rendered as HTML (was showing `<p>` tags).
- "Important" box no longer has a large top gap; today list and flight board spacing; "Provided by … Terms" link.
- Print: documents laid out at exactly 210mm with their own margins, colours forced, rows never split — identical on any device, browser or printer.
- "Sent" badge now on every sent communication, not only those without content.

## 1.6.0 — 4 November 2026
### Added
- Staging base + **Test everything** grid and **Render staging bookings** (Status tab).
- **Modules**: every page section switchable; new modules ship off.
- Daily health digest email; Engagement tab (views, acceptance funnel, what customers ask to add, by stage) with optional Vision table.
- AI copy feedback (Good / Rewrite… / Never) on the sources panel; editor's notes feed the next generation.
- Notifications endpoint for Vision automations (`balance_reminder`, `documents_issued`, `payment_received`, `welcome_home`, `quote_reminder`, `custom`); optional Trip Page Views / Last Viewed fields.
- Up-next summary card; compact folds for the long tail; share with fellow travellers; travel wallet document; compare quotations; accessibility statement page.
- Airtable resilience: stale-while-error (three-day copy), self-retrying loading page, per-base request budget.

## 1.5.0 — 4 November 2026
### Fixed
- Airline/airport guides: a cache-only page build classed job-needing sections as warm and rendered them empty; they now defer to the browser pass. Guides load automatically after the main sections (no need to open the card); polling extended to six minutes.
- Guide parsing: never cache an empty parse as a result; robust JSON/markdown parsing; failure reasons shown.
- Google Places: undefined variable crash on real responses; destinations request any photos; match checking modes (balanced/strict/off).
- Email: MIME plumbing leaked into the visible email; now HTML via wp_mail with a PHPMailer plain-text alternative.
### Added
- Airport picker (search + chips) on contact preferences. Background job queue: one AI job at a time, after responses, never from a page build. Sequential section loading in page order.

## 1.4.0 — 3 November 2026
### Added
- Branded transactional email; contact preferences in My Trips (write-back to Customers); accessibility statement; admin sources panel with request diagnostics; REST nonce retry.
- Communications history ("What we've sent you"); FAQ; instalments/insurance ideas; recommend-us and next-trip chips; on-demand Mint links for any due payment.
### Changed
- Reconfirmation and travel documents merged into one timeline step; AI descriptions research first, write for a customer who has booked; airline guides written from the agent's point of view.

## 1.3.0 — 3 November 2026
### Added
- Destinations from Widgety/Google Places/AI (four sections kept); official travel advice as links; airline/airport AI guides; airline and operator logos; reviews ≥ 4 stars only; no hotel website links; "What happens next" timeline from task checkboxes; Airtable comments on view/accept/question; skeleton loaders; admin content-sources panel; branded conversion modules (reassurance strip, why book, ideas).
- Financial fields locked from customers everywhere (Field Studio allowlist); labels never ids; mixed HTML/markdown feeds handled.

## 1.2.0 — 3 November 2026
### Added
- One theme per Vision tag (26) with editable priority; compliance layer (PTR 2018 key information and standard notices, ATOL attribution rules, trust wording only with evidence, TTA guarantee certificate, price transparency, cooling-off clarity); legal texts editable in wp-admin.
### Fixed
- Primary buttons, heading weights, agent photo, horizontal overflow, countdown semantics (found with real browser renders).

## 1.1.0 — 3 November 2026
### Added
- Print documents (confirmation, invoice, receipts, ATOL certificate, front file, letters), verification gate, customer portal, quotation acceptance with forced reading, Mint custom payments, ICS export, Field Studio, encrypted secrets, signed links with legacy redirects, link-minting API.

## 1.0.0 — 3 November 2026
- Initial build replacing the six legacy snippets: stage-aware trip page, 3-wave Airtable fetch, Widgety / Google Places / AI / flights / weather integrations, admin.
