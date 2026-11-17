# Vision Trips — changelog

Versions follow semantic versioning: features bump the minor, fixes the patch. Shown in wp-admin → Vision Trips → Changelog.

## 2.0.4 — 17 November 2026
### Fixed
- Spacing: the note, the walkthrough card and the quick-message card now sit an even 14px apart (the walkthrough had inherited a section's 40px top padding).

## 2.0.3 — 17 November 2026
### Changed
- The walkthrough is its own slim card directly beneath the agent's note (thumbnail, "Sarah recorded a walkthrough of this quotation", Watch), with the same spacing as the other blocks — the note reads as a letter again.

## 2.0.2 — 17 November 2026
### Changed
- The walkthrough video is now a compact card under the greeting — a small thumbnail with a play button, "Sarah recorded a walkthrough of this quotation", and a Watch button — rather than a hero-sized panel inside the note. Watching opens the video in a viewer over the page (Escape, the close button or the backdrop closes it, and playback stops). The same card serves a Video Message link. The thumbnail uses Airtable's own video thumbnail when there is one, never the trip's hero photo.

## 2.0.1 — 17 November 2026
### Fixed
- A Video Walkthrough (or video message) on its own now shows the note card; previously the card only appeared when there was a written note or an About text. Applies to quotations and bookings alike.

## 2.0.0 — 17 November 2026 (release)
### Housekeeping for release
- Security headers on every plugin page now also send Permissions-Policy (camera, microphone, geolocation, payment and USB switched off for this origin) and Cross-Origin-Opener-Policy, alongside the existing no-store, noindex, nosniff, SAMEORIGIN and Referrer-Policy.
- Dead code removed (the abandoned "Include in Comparison?" rule); tests updated.
- A quiet "Powered by Vision from The Travel Network Group" line on the trip page, the portal, the front page, every document (print included) and every email.
- Plugin metadata set for release (WordPress 6.4+, PHP 8.1+). Uninstall removes every plugin option and transient; the uploads folder (cached images) is left for the host to clear.
- Pre-release checks: all three test suites pass; every stage, document, portal and front-page view renders; 51 CSS/JS/PHP files lint clean.

## 1.18.0 — 17 November 2026
### Added
- **Video Walkthrough** (new attachment field on Bookings): the member's own walkthrough of the trip plays at the top of their note — "Sarah walks you through your trip" — with a click-to-play poster. Only an actual video file counts; a photo or PDF dropped in the field is ignored.
- **Climate for the travel month** on each destination: "In March it's usually 24° by day and 13° at night, with about 9 hours of sunshine a day and 2 rainy days in the month" — the same month over the last three years from Open-Meteo's archive (free), cached for a year.
- **Travel extras with the member's own links**: an upsell with an *Affiliate Link* (new URL field on Upsells) gets a "Book this" button that opens the member's link (counted in Engagement), with "Ask us instead" beside it; upsells without a link keep "Add this".
- **Agent card** under Help: initial avatar, name, "Your travel expert at …", branch phone, the agent's email (from the booking's collaborator field — the only agent detail Airtable's API exposes; it has no profile photos or titles) and a Message button.
### Changed
- **Booking Uploads [External] can never be displayed** — locked like a financial field, whatever Field Studio says, along with any other "uploads [external]" field.

## 1.17.0 — 17 November 2026
### Fixed
- Quotation options had disappeared: the customer's link to their bookings was being read from records fetched without that field. The compare card now fetches the customer's own links directly (Trips or Bookings, whichever the base uses) from the Customer record — same anchor, same Status = Quotation rule.
### Added
- **Hotel facility chips** (Outdoor pool, Spa, All inclusive, Beachfront…): the brochure writer now returns up to eight short facility labels in a separate block beside the copy; they are parsed strictly (plain labels, 40 characters max, nothing else) and shown as chips above the description. Written once per hotel and cached with the copy.
- **Destination facts** (currency, language, time difference, flight time from London, plugs, best time to go) returned beside the destination guide the same way, shown as a facts strip at the top of each destination card.

## 1.16.2 — 17 November 2026
### Changed
- Quotation options: linked by Customer record and Status = Quotation only (no checkbox, no date window). Layout adapts to the count — one option is shown side by side with this quotation, two or three as cards, four or more as a comparison table (name, dates, nights, total, per person, View) that stacks neatly on a phone. Up to twelve options.

## 1.16.1 — 17 November 2026
### Changed
- **Quotation options are linked by Customer record, not email.** The compare card now reads the booking's Customer link and that customer's Trips, keeps the quotations, and — where Vision's "Include in Comparison?" checkbox exists — shows only those the member ticked (an unticked quotation shows no options at all). Without the checkbox it falls back to that customer's quotations from the last 90 days. Two customer records sharing an email no longer see each other's quotes.

## 1.16.0 — 17 November 2026 (closing the gaps against quote-page competitors)
### Added
- **What's included / not included**, with ticks: Vision's own lists when the member keeps them (new optional booking fields "What's Included" and "Not Included", one item per line), otherwise derived from the itinerary — flights with class, nights with room and board, cruise and cabin, transfers, car hire, extras, ATOL — and the exclusions from resort payments plus the usual ones. On the quotation page, folded on confirmed trips, and on the quotation/confirmation document.
- **The agency's own Google rating** ("4.9 on Google · 312 reviews") in the reassurance strip when it is 4.3 or better with ten or more reviews — looked up once a week by trading name and address.
- **Save as PDF** on quotations (the quotation document, now listed first in Documents as "Your quotation (PDF)").
- **Trip route map** — all stays and ports on one map (Maps Embed directions; needs the embed key) at the end of the itinerary.
- **Agent video message** — an optional "Video Message" URL on the booking plays in the agent's note (YouTube, Vimeo or a file; click-to-play).
- **Call me back** — one tap under Help, with a preferred time; arrives with the agent as a message, no number re-typed.
- **About 25 km from Paphos airport** on each stay — the flight that lands before the stay, geocoded once (free) and cached a month.
- **Add to home screen** — a web app manifest per trip with the member's icon and colour, so the trip installs like an app on iOS and Android.
- Messages from the page always reply to the booking's email when none is given.

## 1.15.1 — 16 November 2026
### Changed
- **Find my trip now uses the booking reference and email** rather than searching members by email. The reference names the member (the X0333 in NWG-X0333-…) and the email must belong to a customer of that member, so the lookup is exact with 1,200 members, costs one call, cannot be used to discover which companies an address has booked with, and is never ambiguous. Members whose trips have been opened on this site are known automatically; an optional TTNG member directory base (member code → Vision base id) covers the rest.
- The front page can be a plain holding page instead (Experience → Front page → untick "Include Find my trip").

## 1.15.0 — 16 November 2026
### Added
- **Front page.** The plugin now serves the site's front page (switchable): a neutral, branded landing with a "Find my trip" box — the customer enters the email they booked with, the site works out which member knows them (among the bases it has served) and hands over to My Trips with the address pre-filled for the one-time code — plus a note for customers who already have their link, three trust points and a footer. Headline, introduction, name, logo, colour and contact are set under Experience → Front page. The member's own brand takes over the moment a trip opens.
- A bare /trip/ link now goes to the front page instead of a "not found" message.

## 1.14.2 — 16 November 2026
### Fixed
- "Too many requests" when accepting a quotation: every REST endpoint shared one rate-limit bucket per IP, so the page's own section requests used up the accept allowance. Each endpoint now has its own bucket, and the message says to wait a minute.
### Changed
- On a quotation nothing is paid directly: the deposit row's button is now "Accept and pay deposit" and opens the same accept flow as the top of the page (which takes the deposit at the end). Once booked, balance payments go straight to the payment portal as before.
- Ship sections: cabin, restaurant and venue names are styled as items (smaller, lighter, indented) beneath their section headings.
### Added
- **Ship film** from Widgety's video_url, back on the cruise card as a click-to-play poster (nothing loads until pressed); YouTube and Vimeo play in privacy-friendly embeds, direct files in a native player.

## 1.14.1 — 16 November 2026
### Changed
- The customer's email address is never shown or asked for again on the trip page: the quick message and the accept pop-up send to the address on the booking, with only a small "reply to a different email address?" link.

## 1.14.0 — 16 November 2026 (member feedback round)
### Added
- **Who's travelling** on every status: each traveller's name exactly as booked, lead passenger, age (or date of birth on verified sessions where the setting allows), nationality, passport ending ···876 and expiry, meal and special requests, and a warning when a passport expires within six months of the return. One-tap "Spot a mistake? Tell us" and "Update passports and details" (My Trips). Switchable (Modules → Who's travelling).
- Second accept box under Price and payment plan with the same two buttons as the hero ("Accept and pay deposit", "Ask a question").
- "Show fewer" after "Show more", so long lists can be folded back up.
### Changed
- Quick navigation bar now wears the brand colour (active item in white), matching the floating button.
- Masked emails show the first and last letter (d•••••a@yahoo.com), everywhere.
- The accept pop-up no longer asks for the email address again: the booking's address is shown masked with a "use a different address" link.
- Cruise ship sections: cabins, restaurants and venues are collapsed to a tappable name until opened, so twenty cabin categories no longer push the page down.
- "Why book with…" never renders empty: it uses the Reasons to Book, otherwise the About & Bio from Brands & Branches, with the "Why Choose…" header/subheader when set.
- "Make it even better" shows only the upsells selected on the booking in Vision, each with its image (a tile with the brand accent when there is none). The generated ideas are now an opt-in switch (Experience → "Also show generated ideas"), off by default.
- "What happens next" uses estimates — "Around two weeks before you go", "A few days before you go", "Shortly after you're home" — rather than dates a customer could hold the member to; the balance due date stays, as it is a real deadline. Steps tick off from the Bookings task fields: Booking Confirmation, Booking Reconfirmed, Travel Documents, Pre-Departure Call, Post-Travel Follow-Up.
- Documents open in a new tab.

## 1.13.1 — 16 November 2026
### Changed
- When a member has the concierge switched off, the floating button becomes "Message Sarah" and takes the customer straight to the quick message form (the compact one on quotations), so there is always a one-tap way to reach the agent from anywhere on the page.

## 1.13.0 — 16 November 2026
### Changed
- **Accepting a quotation no longer requires reading each section to the end.** The key information and terms are presented and highlighted, opening a section ticks it, and the Accept button needs only the name, email and the explicit confirmation. Which sections were opened is recorded in the acceptance audit trail rather than enforced.
- **Quick message**: on quotations it now sits near the top (under the agent's note) as well as under Help; the customer's email is pre-filled and shown masked ("We'll reply to e•••@example.com") with a "use a different address" link instead of being asked for again. The form is a module members can switch off (Experience → Modules → Quick message form).
- **Icons** redrawn as clear silhouettes: plane, ship, car/transfer and attractions (a ticket-with-star); every itinerary kind now reads instantly.
### Added
- A second **Accept and book** box under the price on quotations, so nobody has to scroll back to the top to proceed.
- **Show more** on long lists: destinations and stays show the first three, messages the first four, long itineraries the first five days, with a "Show N more" button; printing shows everything.

## 1.12.1 — 16 November 2026
### Changed
- Vision gains `Departure Terminal` and `Arrival Terminal` (single line text) on Bookings [Elements]: the plugin reads them first, normalises any style of entry ("5", "T5", "Terminal 5", "2A"), and the concierge can answer "which terminal?" from them. Status → Test everything now reports whether the two fields are present on the base.

## 1.12.0 — 16 November 2026
### Changed
- Flights are named by airport, not code: "London Heathrow – Paphos" as the card title (and in the today list, wallet and confirmation), with codes, terminals and the flight number on the line beneath. The countdown says "until you fly from Heathrow". A flight that carries only an IATA code gets its name from the Airports table (cached a month).
### Added
- Terminals against flight details — from a Vision field if one is added (Departure/Arrival Terminal), otherwise parsed from the element's own text ("check in at Terminal 3", "arrives Terminal 1"), otherwise from live airport data once it has been fetched. Shown on the card, the confirmation and the travel wallet.
- Per-person price alongside the total (hero, payments, confirmation): Vision's Cost Per Person when present, otherwise the total shared across the travellers; shown when there is more than one traveller.

## 1.11.1 — 6 November 2026
### Fixed
- "This trip earns you 1 loyalty points": the points number was read from `Loyalty Points Awarded`, which is a checkbox (the tick became "1"). Points now come from `Loyalty_Total Points`; the checkbox marks them as credited. Wording follows the state — "earns you … credited after you return on …" before the trip, "will be credited shortly" once home, "You earned …" once awarded, "Book with us and earn …" on a quotation — with correct singular/plural and "put towards this balance / your next trip" for the customer's available points. The line can no longer split into columns.

## 1.11.0 — 5 November 2026
### Added
- **Loyalty, built on the live Vision schema.** Payments: rows with Payment Type "Loyalty Redemption" (the scheme's own funding) are never customer-facing and never touch totals; customer payments receipted by the method "Loyalty Redemption" show as "★ 2,500 points · Loyalty points redeemed" with no price (points from the linked Loyalty Transactions). Under the totals: "This trip earns you N loyalty points, credited after you return on …" (or "Book with us and earn N points" on a quotation), the customer's available points and £ value, and "Use them on this trip". Only when the member's Loyalty Scheme is enabled.
- **Portal → Loyalty**: points available with £ value and expiry, lifetime points, full history (Earn / Redeem / Adjustment / Expiry with booking names), VIP badge.
- **Portal → Details**: per traveller, passport (number, nationality, issuing country, issue and expiry), driving licence, next of kin, and airline/cruise loyalty programmes (edit, or add from the base's own airline and cruise-line lists). Names, dates of birth and contact details stay read-only with a contact-us path, because they change every linked booking. Security: OTP session, nonce, 20 changes an hour, strict server-side validation, a fixed allow-list of fields on records that belong to the signed-in customer only, passport numbers masked in placeholders, and a comment on the Customer record for every change.
- **VIP experience**: gold VIP pill in the hero, a "VIP priority · your direct line" card first in the strip, the concierge is especially attentive and says handoffs will be prioritised, agent emails and Vision comments flagged ⭐ VIP, VIP shown in the portal.
### Changed
- **Vision data is fetched fresh on every page view** — never an old copy. The fetched graph is reused only by that view's own section requests (default 180 s) so a page does not fetch three Airtable waves five times.
- Hero titles: a text-anchored scrim and darker gradient so a bright image never swallows the headline.
- Google Places results cached 30 days (photos already on disk); airline and cruise-line lists cached a day.

## 1.10.4 — 4 November 2026
### Fixed
- Reassurance strip: one, two, three or four cards always fill the row (no empty fourth slot); on phones an odd last card goes full width.

## 1.10.3 — 4 November 2026
### Fixed
- Images rendering as a strip and stalling: the image endpoint sent a Content-Length that PHP's output compression (on by default on Plesk) then changed, so browsers waited for bytes that never came. Files are now streamed with every output buffer discarded, compression off, chunked output, and Content-Length only when PHP cannot alter the byte count.
### Added
- Gallery tiles shimmer until their image has loaded, then fade in; photos not yet on disk are also queued for download in the background so later views are instant; photo files are 1200px wide (smaller, same quality at the sizes shown).

## 1.10.2 — 4 November 2026
### Fixed
- **Images back, immediately.** 1.10.1 hid Google Places photos until a slow background queue had fetched them, so galleries sat empty. Photos (and Airtable attachment images: hero, element photos, memories, member logos) are now served through the site's own image endpoint: the first request fetches from Google/Airtable server-side, stores the file and streams it; every later request comes straight from disk with long cache headers. Pictures appear at once, cost one fetch per image per fortnight, never depend on browser-side API keys, and never expire with the Airtable link. Rewrite rules now refresh automatically on every plugin update so new routes work straight after upload.

## 1.10.1 — 4 November 2026
### Fixed
- Empty button on the hero of past trips (the "A trip to remember" stage had no label for its second button); no button can render without text now.
- Hotel and destination photos are only ever served from the site's own copy: a direct Google URL can fail in the browser when the API key is restricted, which showed as blank tiles. Until a copy exists the photo is simply not shown; the section re-checks quietly and the gallery fills in without reloading what is there. Hero images that fail fall back to the gradient hero.
- Galleries: every image the same height with its natural width (no more mismatched tiles or tall blanks).
- "Writing a few words about your stay…" placeholders removed; the description appears when it exists.
- Concierge was handing off easy questions: "I can confirm transfers are included" tripped the promise check and "£1,500" did not match "£1,500.00" in the booking. Confirmations are now flagged only for changes/requests, amounts are compared as numbers, the model is told most questions need no search, odd bytes in booking text can no longer break the API request, and the handoff reason is written into the Vision comment and shown to WordPress admins under the answer.
### Added
- Comments on the Bookings record now @mention the booking's agent (first collaborator field found: Travel Agent, Agent, Booking Owner, Owner, Consultant, Assigned To, Created by) so they get the notification — on questions, acceptance, concierge exchanges and document opens; optionally on every page view (Experience → Comments in Vision).

## 1.10.0 — 4 November 2026
### Changed
- **Trip concierge rebuilt to be useful first.** It now sees the whole trip (every itinerary item with its details, passengers, payments and their status, documents, service steps, the agent's note, extras), the brochure content already written for the hotels, ships and destinations, Google Places facts, live flight status and today's date, the member's templates and terms, the legal texts and key information — about 15k tokens. It answers general travel questions freely, researches official sources by default (gov.uk/FCDO, TravelHealthPro, the airline, airport, cruise line, hotel or tourist board) and shows which sources it used. Only the genuinely contractual things are handed to the member (changes, confirmations, quotes for extras, refunds, cancellations, room/seat/assistance requests) and the customer still gets whatever can safely be said first. Replies are parsed from a tagged block so research notes never break an answer; model fallback; longer timeouts. Validator relaxed to match: promises/confirmations, unqualified amounts not in the booking, entry-rule statements without an official source, competitors, internal finance.
- Concierge panel restyled (wider on desktop, agency avatar, accent bar on answers, lists, source chips); suggested questions now come from the booking (baggage, check-in, dress code, currency, visa, plugs…). Engagement tab shows the self-service rate.
### Fixed
- Images stopping loading: Airtable attachment URLs expire within hours. Hero, element, member and memory images are now downloaded once into uploads by the background queue (keyed by attachment id) and served locally; broken tiles remove themselves instead of showing a broken icon.
- Memories on the welcome-home module are a proper photo grid (lead image plus tiles), only shown with three or more photos.

## 1.9.1 — 4 November 2026
### Fixed
- **Disappearing sections on big bookings.** 1.8.0's photo caching downloaded every Google Places photo inside the section request; with many destinations that ran past the host's PHP time limit, the request died and the section was hidden. Photos are now fetched by the background job queue (the direct URL is shown until the local copy exists), every section has a live-lookup time budget inside the host's limit, a section that reaches it renders what it has and completes itself on the next quiet check, and any exception in a section build is logged and retried rather than hiding the section.

## 1.9.0 — 4 November 2026
### Added
- **Trip concierge** (module, off by default): customers ask questions on their trip page; Claude answers only from a context pack built from what the customer can already see (itinerary, payments, documents, protection, service steps, FAQ, the member's templates) plus stable general knowledge, under rules written for the PTRs and consumer law. It cannot promise, confirm, quote or change anything, give visa/medical/safety rulings, or mention other companies; every answer is checked (amounts must already be in the booking, no confirmations, no visa rulings, no competitors, no internal finance) and anything that fails — or that the model cannot answer — becomes a handoff: the member gets a branded email with the question and a reply link, and the customer sees "I've passed this to Sarah". Optional research (two searches), per-booking and site-wide daily caps, 24-hour answer cache, short history. Every exchange is written to the Bookings record as a comment and counted in Engagement.
### Changed
- **Every page view is now recorded on the booking straight away** (only a reload within 90 seconds from the same device is folded), agent-link views are labelled as such, and document opens (confirmation, ATOL certificate, wallet…) are recorded too.

## 1.8.0 — 4 November 2026
### Fixed
- Bookings with many destinations/cruise ports could lose their itinerary or accommodation: wide Airtable fan-outs burst past the per-base rate limit, a wave came back empty, and the partial result was cached and even saved as the "good copy". Fan-outs now run in slices of four with backoff retries; a partial fetch is never cached for more than ten seconds or saved, the page serves the last complete copy with the "refreshing" note, and the sources panel names which records were missing.
- Gallery images no longer disappear and reload while AI copy arrives: re-renders are skipped when the HTML is unchanged, and when only text changed the text is swapped in place and the galleries are left alone. The first three gallery images load eagerly.
### Added
- **API usage & costs** tab: every outbound call counted per provider per day, AI tokens and web searches, estimated cost in USD/GBP from editable unit prices, today / 7 / 30 days.
- **Google Places photo caching**: photos are downloaded once per place into uploads and served from the site, so photo cost is per place per fortnight rather than per page view (the biggest single saving). Switchable on the Costs tab.

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
