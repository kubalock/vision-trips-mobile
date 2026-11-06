# Vision Trips

The customer-facing trip experience for **Vision by The Travel Network Group**: quotations, bookings, travel documents, payments and a customer portal — one WordPress plugin, branded for every member from the data already in Airtable.

It replaces the six legacy snippets (`TTNGBOOKING_V2`, `TTNG_GEMINI_PRINT`, `TTNG_BASIC_BOOKING`, `TTNG_ATOL_CERTIFICATE`, `TTNG_GEMINI_INVOICE`, `airtable_letter`) with one secure, cached, testable codebase. Old links keep working.

## What the customer gets

| Journey stage (computed) | The page becomes |
|---|---|
| Quotation | The offer: price, what's included, the agent's note, a forced-read acceptance flow that lands on the deposit payment |
| Quote expired / closed / cancelled | A calm state page with the right next step and contact details |
| Confirmed, > 14 days | Countdown hero, itinerary by day, where you're staying (Google Places + AI copy), ship & voyage (Widgety), payments with Pay now, documents, protection |
| 1–14 days | "Before you go" checklist (balance, passport validity from Vision data, API, entry hints, insurance, FCDO) |
| Departure day / away | "Today" module: live flight board, destination weather, what's happening now and next, emergency line first |
| Returned (≤ 30 days) | Welcome home: review link (Google/Trustpilot from the brand record), plan-the-next-one, memories |

Every one of the 26 Vision **Tags** has its own theme (typeface, weight/width/softness, tracking, surface wash, hero overlay, motif, corner radius) — see wp-admin → Themes for the priority order and per-tag overrides. The member's **Primary Colour** is always the accent; **Primary/Secondary Web Font** override the theme fonts when set. **Member Tone** changes the register of the copy. **Surprise Booking** hides details. **Enable 2FA** forces an email code.

## Operating it like a product

- **Staging + "Test everything"** (Status tab): one real booking through Airtable, Google Places, Widgety, AI, flight status, weather, Mint readiness, email and an Airtable comment, then a full render — timings and the real error text. **Render staging bookings** pushes every record you list through the page build before a release.
- **Modules** (Experience tab): every part of the page can be switched on or off; new modules ship off (Up next card, compact long tail, engagement tracking, share with fellow travellers, travel wallet, compare quotations).
- **Daily health digest**: warnings and errors grouped by message, emailed each morning (Tools & logs).
- **Engagement** (own tab): page views, acceptances started → completed, Pay-now taps, what customers ask to add, by stage, and the last 60 events. Optionally appended to a Vision table (`Booking, Event, Detail, Stage, When, Device`) in the background.
- **AI copy feedback**: Good / Rewrite… / Never buttons on every AI row of the sources panel. Rewrite takes an editor's note the next generation must follow; Never blocks that piece and the page falls back to the next source.
- **Notifications from Vision automations**: `POST /wp-json/vision/v1/notify` (X-Vision-Key) with `{base, record, template}` sends a branded email with the trip link — `balance_reminder`, `documents_issued`, `payment_received` (with the ATOL certificate link when it applies), `welcome_home` (with the review link), `quote_reminder`, or `custom` (`subject`, `heading`, `body`). A comment is written on the booking each time. Optional `Trip Page Views` / `Trip Page Last Viewed` fields on Bookings are kept up to date so automations can nudge unviewed or abandoned quotations.
- **When Vision is slow or rate-limited**: the page serves the last good copy (kept three days) with a quiet "showing as last saved" note and refreshes itself when a fresh copy succeeds; with no copy yet it shows a calm loading page that retries on its own. Requests stay under Airtable's per-base budget.
- **Share with fellow travellers**: the lead passenger mints links that show the itinerary, documents and contact details and nothing financial.
- **Travel wallet**: one printable page with times, references, addresses, pick-up instructions, supplier documents and every emergency number.
- **Compare quotations**: other open quotations for the same customer, side by side, on the quotation page.
- **Accessibility statement** at `/trip/accessibility/` (editable under Legal), linked from every page.

## Consumer law and regulation

Built in, driven by the booking's `ATOL` and `Licensing` fields (wp-admin → Legal holds the editable texts; they are plain-English summaries with links to the statutory wording and **must be confirmed by TTNG compliance before go-live** — this is engineering, not legal advice):

* **PTR 2018 pre-contract information** (reg 5): a generated "What you are booking" block — destination/dates, transport with times, accommodation with category/board, included extras, travellers, total price including local payments, payment schedule, organiser/retailer identity and contact, protection, cancellation, passports/visas/health, insurance, special requirements — is the first section of the quotation acceptance flow, appears under "Who you're booking with", and is printed on the confirmation.
* **Standard information notices**: package (Schedule 1) when the sale is a package; linked-travel-arrangement notice (Schedule 2) when sold as agent without a flight with more than one service type (switchable); "not ATOL protected" when the Licensing is *airline ticket agent*.
* **ATOL**: "ATOL protected" is only shown when the licensing supports it; the holder name and number are always stated; the ATOL badge is suppressed otherwise; the certificate becomes available as soon as the first payment is recorded (not only on Confirmed) and its date of issue is the first payment date; flight-only certificates carry the warning text.
* **Price transparency**: the total shown is inclusive; local/resort payments are shown as part of the total trip cost, not as a footnote.
* **Cancellation**: no cooling-off claim; the exemption for date-specific travel is stated and cancellation charges are signposted to the booking conditions.
* **TTA members**: Safe Seat Plan guarantee certificate in the documents hub; trust-account wording throughout.
* **Identity**: member legal entity, company number, VAT number and registered office on every page and document; privacy and complaints links from the brand record.

## Requirements

* WordPress 6.4+, PHP 8.1+, pretty permalinks (Settings → Permalinks → Post name).
* HTTPS (session cookies are `Secure`).
* An Airtable personal access token with `data.records:read`, `data.records:write` (quotation acceptance write-back) and `schema.bases:read` (Field Studio), with access to every member base.
* `libsodium` or OpenSSL (secrets are encrypted at rest with a key derived from `AUTH_KEY`/`SECURE_AUTH_KEY`, or `VISION_TRIPS_MASTER_KEY` if you define it).

## Install

1. Upload the `vision-trips` folder to `wp-content/plugins/` and activate.
2. Vision Trips → **Connections**: paste the Airtable token, set a reference base ID (any member base built from the Vision template), optionally Widgety / Google Places / AI / flight keys. Save.
3. Vision Trips → **Status**: all dots green. Use **Open a booking** to view any booking in agent scope.
4. Visit Settings → Permalinks once (or Tools → Flush rewrite rules).

Secrets can also live in `wp-config.php` and then cannot be edited in wp-admin:

```php
define('VISION_TRIPS_AIRTABLE_PAT', 'pat…');
define('VISION_TRIPS_GOOGLE_PLACES_KEY', '…');
define('VISION_TRIPS_MASTER_KEY', 'a long random string'); // optional, for encryption at rest
```

## URLs

| URL | What |
|---|---|
| `/trip/{token}/` | The experience |
| `/trip/{token}/documents/confirmation/` | Booking confirmation / quotation (A4, print to PDF) |
| `/trip/{token}/documents/invoice/`, `…/receipts/`, `…/receipts/{paymentId}/`, `…/atol/` | Invoice, receipts, ATOL certificate |
| `/trip/{token}/documents/letter/`, `…/print/` | Letter generator and front file — **agent scope only** |
| `/trip/{token}/ics/` | Add the whole itinerary to a calendar |
| `/my-trips/?m=appXXXX` | Customer portal for a member base (email + one-time code) |
| `?member=app…&booking=rec…` on any URL | **Legacy links** redirect to a signed trip link. Add `&k={agent key}` (Security tab) for agent scope. Old `/atol/`, `/invoice/`, `/letters/`, `/printtrip/`, `/frontfile/` paths map to the matching document. |

Tokens are opaque: `base64url({v,b,r,s,e}).hmac`. They carry base id, record id, scope (customer / agent) and optional expiry, and are verified with the link secret (rotatable, previous secret honoured).

### Minting links from Airtable automations

```
POST https://my-trip.co.uk/wp-json/vision/v1/links/mint
X-Vision-Key: <API key from Security tab>
{ "base": "appXXXXXXXXXXXXXX", "record": "recXXXXXXXXXXXXXX", "scope": "customer", "path": "" }
→ { "url": "...", "documents": { "confirmation": "...", "atol": "...", "letter": "..." } }
```

Store `url` in a Vision field (e.g. a new `Trip Link` field) and use it in emails/SMS. `POST /wp-json/vision/v1/cache/purge` with `{base, record}` clears one booking's cache after an automation changes it.

## Security model

* **Quotations**: by default open from the link (configurable: surname or postcode question). Supplier names/references are hidden on quotations (switchable).
* **Everything else**: once per device, the customer answers one question — postcode on the booking, or surname + date of birth of anyone travelling — or asks for a 6-digit email code. Verified devices get a signed, httpOnly, SameSite cookie for 30 days (configurable). Signed links can be trusted to skip the question (default on); legacy links never are.
* **Enable 2FA** on the booking forces the email code regardless of settings.
* Rate limits on verification attempts, OTP sends, REST calls and page loads; lockouts are logged (Tools & logs) without customer data.
* Agent documents (letters, front file with net costs) need an agent-scoped token (wp-admin "Open a booking", the mint API, or the agent key on legacy links). Agent tokens expire (24h default).
* Every page sends `no-store`, `noindex`, `nosniff`, `SAMEORIGIN`, `Referrer-Policy` headers.
* Mint credentials (`Mint | API Key`, `Business Unit`) are read from the brand record and never reach templates; custom-amount payments are server-capped at the balance due.
* Nothing customer-specific is sent to the AI provider — only Google Places facts about the hotel.

## Data model (Vision → plugin)

`config/fields.php` maps every logical field to ordered candidates of Airtable field names, derived from the live Vision schema. Rename a field in Vision → change it there, not in code. The plugin reads:

* **Bookings**: reference, name, Status, Tags, Holiday Type(s), Sector, dates, Countries, Destinations, Hero Image, Total Price, MS Paid / MS Outstanding, next payment, balance due date, Customers, Customers [People], Elements, Payments, Upsells, Brands & Branches, Members, Personalised Message, agent, Quotation Expiry, cancellation fields, ATOL, ATOL No., leadSupplier, Enable 2FA, Surprise Booking, Group Booking, out-of-hours fields, Mint booking id, Alternative Currency fields, Supplier Tickets Received…
* **Bookings [Elements]**: typed essentials per kind (flight / stay / cruise / transfer / car hire / parking / train / attraction / misc) plus anything made visible in **Field Studio**.
* **Bookings [Payments]**, **[Passengers]**, **[Rooms]**, **[Cabin]**, **[Cruise Itinerary]**, **[Upsells]**, **Customers**, **Customers [People]** (DOB, passport expiry, SSR, meals), **Brands & Branches** (the full brand kit incl. templates, trust account, social, review URLs, Display Logos, fonts), **Members** (legal entity, T-ATOL), **Suppliers**, **CMS [Airports/Airlines/Locations/Cruise Ships]**.

Loading is three parallel round-trips (booking → first-level links → second-level links) and cached briefly (60 s default), so repeat loads and REST calls are instant.

### Quotation acceptance write-back

Create these fields on the Vision **Bookings** table (defaults in Experience tab, editable):

```
Quotation Accepted|checkbox
Quotation Accepted At|datetime
Quotation Accepted By|text
Quotation Accepted IP|text
```

Add an `…|log` line to append a dated audit line to a long-text field. The customer must open and scroll every section (names, important information, who you're booking with / protection, terms) before the button unlocks; the agent inbox and the customer both get an email; then the customer is sent to the deposit's `Payment Link URL` (or a Mint link is created on the fly, or bank details are shown). Vision's **Status** is not changed by the plugin — the agent confirms once suppliers confirm.

## Content sources (and owning the journey)

Customers should never need Google. Each section fills from the richest source available, falls back gracefully, and (for WordPress admins) reports where it came from in a **Content sources** panel at the foot of the trip page:

| Section | Order of sources |
|---|---|
| Where you're staying | Google Places (business-posted photos first, rating only if ≥ 4, reviews only ≥ 4 stars, no website link so nobody books direct) → AI description grounded in those facts → Vision images |
| Where you're going | Images: Widgety ports/destinations (all) → Google Places photos. Overview: Widgety → AI guide → Places summary → Vision CMS. The three sections (Things to do, Practical information, Culture) come from Vision CMS where filled, otherwise from a researched AI destination guide written in the member's tone and cached 30 days. "Official travel advice" is links only: FCDO, TravelHealthPro, NHS Fit for Travel, gov.uk entry requirements |
| Ship and voyage | Widgety ship profile + voyage by Voyage Code → Vision cruise itinerary rows |
| Flights | Airline logo (Vision airline record, else pics.avs.io by IATA code) · live status on the day · AI "Flying with…" and UK airport guides (generic, stable facts only, cached 60 days, loaded when the card is opened) |
| Payments, documents, protection | Vision |

Everything linked is shown by label, never by record id; collaborator fields show the person's name.

### Reading the sources panel
A row marked **deferred** means the section was not cached when the page was built and is being looked up by the browser; its real rows (Google Places verdict, Widgety match, AI status) are appended underneath as they arrive. "AI (writing in the background)" means a job is running; if a job fails the row says "AI failed: …" with the API's reason, and the section falls back to the next source rather than waiting forever.

### Diagnosing a section that is not loading
The admin-only **Content sources** panel at the foot of a trip page lists every outbound request made for that page (and for each async section as it lands): endpoint, status, time, and the error text on failure. Failures also go to Tools & logs. **Connections → Test AI** makes a live call and shows the model that answered; **Regenerate all AI copy** invalidates every cached description and guide so they are written afresh on the next view (the rest of the cache is untouched). If a model id is retired the plugin falls back automatically (claude-sonnet-5-5, then haiku) and logs it. Negative lookups (a hotel Places can't find, a ship Widgety doesn't know) are cached for 30 minutes only, and configuration errors are never cached, so fixing a key takes effect immediately — or use Tools → Purge all caches.

### What we've sent you
Sent items from **Bookings [Customer Communication]** (Sent ticked or Status = Success; never drafts, failures or self-sends) appear as a history on the trip page with subject, channel, date and the message body, plus "ask us to resend".

### AI copy: research first, sell responsibly
Hotel, ship and destination descriptions are written by the model after it researches the specific property or place with Anthropic's web search tool (official site + reputable recent sources, max 3 searches), then writes 80–120 words for a customer who has already chosen it — to build anticipation, in the member's tone, mentioning the room/dates booked. The prompt enforces UK consumer-law guard rails: only verified facts, no prices/awards/star claims not in the data, no superlatives or guarantees, no weather or safety promises, no competitors or "book elsewhere". Accounts without the web-search tool fall back to verified facts only. Airline and airport guides are written from the agent's point of view: the airline is the supplier; extras (seats, bags, lounges, parking, upgrades, insurance) are "your travel agent can arrange"; the airline app is mentioned only for check-in and live status.

### Who the ATOL holder is
A member only appears as the ATOL holder when it genuinely holds one: Global members (3973), ITE (T7400), or a member with **T-ATOL Enabled** and a T-ATOL number. Any other flight-inclusive package or flight-only sale is treated as a sale **as retailer for the package organiser**: the holder shown is the lead supplier with the booking's ATOL number, and the member is named as retailer. The certificate issuer/protector follow the same rule. A trust account is only mentioned for TTA members or brands with trust account details in Vision; otherwise protection is described as "set out in your booking conditions".

### AI copy never blocks a page — and never competes with it
AI descriptions and guides go into a single queue and run **one at a time site-wide**, always after a response has been sent (PHP-FPM `fastcgi_finish_request`), handing over to the next job via a signed loopback request (WP-Cron as fallback). Nothing is queued by a page build; jobs start from the browser's section requests. So a hotel's first research never ties up the PHP workers that the page and its sections need. The section renders with whatever is available and quietly re-checks until the copy is cached; a failed job is remembered for an hour with its reason.

### Loading order
Third-party sections load strictly in page order — stays, cruise, destinations, weather, flights — one after another, each skeleton visible until it lands; guides inside an itinerary card join the queue when the card is opened. The admin sources panel shows every request the browser pass makes and any section it had to hide, with the reason.

### Google Places match verification
Before any photos or reviews are shown, the result is checked against what Vision calls the place. **Connections → Google Places → Match checking**: *Balanced* (default) shows the result unless it is clearly the wrong place — a lodging-typed result needs a fair name match, a non-lodging result must match the full name closely, and anything over 150 km from Vision's coordinates needs a near-perfect name; *Strict* requires a clear name match, lodging type and ≤ 40 km; *Off* trusts Google's first result. The verdict (e.g. "matched: name 1.00, address ✓, lodging ✓") appears in the sources panel for every stay. Rejected lookups are cached for 30 minutes only.

### Pay now on every due payment
Where Vision has a `Payment Link URL` it is used; where it doesn't, and the brand has Mint credentials and the booking a Mint booking id, "Pay now" creates the link on demand for that exact scheduled amount (the browser never supplies the amount). The admin sources panel reports how many due payments carry a link and whether Mint on-demand is ready.

### Quick answers and growth prompts
A generated FAQ answers the questions that generate most calls (balance date, tickets, changes, who to call abroad, protection). Ideas include spreading the cost and travel insurance; the welcome-home module adds "Recommend us" (one-tap share of the member's details) and next-trip chips that pre-fill a message.

### Branded email
Every email the plugin sends — one-time codes, acceptance confirmations (customer and agent), message notifications and the "got it" acknowledgement to the customer — is a branded HTML email in the member's identity: logo (copied once into uploads, because Airtable attachment URLs expire), accent colour, one clear button, legal footer, plain-text alternative. Reply-To is the brand's customer inbox.

### Contact preferences in My Trips
After signing in, customers can set Email / Text / Post marketing, preferred departure airports and preferred travel months. Saves write straight to the Customers record(s) (`Email Marketing`, `Email Marketing Unsubscribe`, `SMS Marketing`, `Postal Marketing`, `Preferred Departure Airport(s)`, `Preferred Travel Month(s)`) and leave an audit comment on the customer. Airport options come from the Vision schema when Field Studio has loaded it.

### Page first, external sources after — and nothing depends on JavaScript
Everything from Vision (hero, itinerary, passengers, payments, documents, protection, help) is server-rendered and visible immediately. Third-party sections (Google Places, Widgety, AI copy, live flights, weather) are rendered **inline from cache when the data is already there** — so the second view of any trip is complete with no browser call — and only on a cold cache do they show a shimmering skeleton that `vision.js` fills from the REST API. Anything that fails to load simply does not appear; WordPress admins see the reason in the sources panel and the browser console. A stale REST nonce is retried automatically. The offline service worker and the strict Content-Security-Policy are opt-in (Security tab) because both can misbehave on hosts where the site URL and plugin URL differ.

### Engagement comments in Vision
When a customer views the trip page (once per device per day), accepts a quotation or sends a message, the plugin posts a native comment on the Bookings record (time, device, IP, how they verified, stage). Token scope needed: `data.recordComments:write`. Switch off under Experience if you prefer.

### What happens next
The Bookings task checkboxes — Booking Confirmation, Booking Reconfirmed, Travel Documents, Pre-Departure Call, Post-Travel Follow-Up — drive a "What happens next" timeline so the customer always knows when they'll hear from you.

### Built to convert
Reassurance strip under the hero (protection, named expert, tailored, out-of-hours), "Why book with us" from the brand's Reasons to Book, Vision upsells plus data-driven ideas (transfers, parking & lounge, cabin upgrade, experiences, room upgrade, cruise packages, extend the stay) each with a one-tap "Ask us" that pre-fills a message to the agent. Nothing financial from Bookings [Elements] is ever shown by default — Field Studio starts with every unmapped field hidden.

## Integrations

| Service | Used for | Notes |
|---|---|---|
| **Widgety** | Ship profiles (facts, accommodation, dining, entertainment, deck plans) and the voyage itinerary by **Voyage Code** | Auth is `app_id` + `token` query params; two credential slots. The API version is negotiated with the `Accept` header, and the ship / holiday lookup paths are settings — **verify both against developer.widgety.co.uk for your V3 account** and use "Test Widgety". Vision's own `Visiting Ports` rows are the fallback itinerary. Cached 7 days. |
| **Google Places API (New)** | Hotel/POI profile: photos (business-posted photos first), rating, address, website, phone, editorial summary, coordinates, one review quote | Text search with location bias from Vision's CMS [Locations] coordinates. Cached 14 days. Maps Embed API key optional. |
| **Anthropic (Claude)** | 60–90 word hotel/destination descriptions grounded only in the Places facts | Model configurable; cached 30 days; off by default if no key. |
| **AeroDataBox (RapidAPI)** or **AviationStack** | Live status, terminal, gate, delay, belt for flights within 48h | Only called on departure/return days; cached 3 min; refreshed in-page every 3 min. |
| **Open-Meteo** | Destination weather (keyless, free) | Coordinates from Places / CMS Locations, else geocoded. |
| **Mint Payments** | Pay-now links from Vision's `Payment Link URL`; on-the-fly links for deposits and custom amounts | Brand credentials from Airtable. |

## wp-admin (TTNG only — members never log in)

* **Status** – health checks, open any booking.
* **Connections** – keys with one-click **rotation** (Airtable active/standby with automatic 401/403 fail-over), test buttons.
* **Field Studio** – reads the Vision schema and lets you tick which element/booking/payment fields customers see in "More details", rename and order them. Typed essentials are always designed; financial/internal fields are hidden by default.
* **Security** – challenge policy per status, OTP, device memory, API key, link-secret rotation, agent key.
* **Experience** – quotation acceptance, supplier hiding, surprise mode, custom payments, ICS, portal, URL slugs, footer attribution.
* **Themes** – tag → theme overrides.
* **Tools & logs** – purge caches, flush rewrites, redacted log.

## Development

```
php bin/preview.php ./preview     # renders every stage of two demo bookings through the real templates (smoke test)
php bin/selftest.php              # rules that must never regress (ids, financial locks, themes, protection, stages)
php bin/fragtest.php              # every third-party section through its real code path with a fake HTTP transport
php -l $(find includes -name '*.php')
```

`bin/stubs/wp.php` provides enough WordPress surface to render templates headlessly; `bin/fixtures/*.php` are Vision-shaped graphs with stage-relative dates and integration mocks.

## Roadmap / not in v1

* Apple/Google Wallet passes (needs signing certificates / service account).
* SMS one-time codes (currently email via `wp_mail`; plug in a transactional provider).
* Widgety touring (non-cruise) holiday content once the endpoint shape is confirmed.
* Loyalty points display (`Loyalty_Total Points` exists on Bookings; needs the scheme rules).
* Co-traveller invitations (separate sessions per traveller).
