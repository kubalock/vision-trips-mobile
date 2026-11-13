# Customer App invitations and email sign-in

Agent creates an invitation → customer opens an opaque trip link → customer verifies with a six-digit email code →
the app receives a session → the trip is saved in My Trips.

The link identifies the Airtable base, Booking and intended Customer **only on the server**. The email code is what
authenticates the customer. There is no customer directory and no base selector.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Canonical issuer and resolver | `apps/api/src/invitations/customer-invitations.service.ts` | Creates, resolves, revokes and verifies invitations; the only code that mints `vt_` tokens. |
| Durable state | `DurableAuthStore` (`customer_invitations`, `invitation_otps`) | SHA-256 hash of each token, Airtable IDs, scope, created / expires / sent / accepted / revoked times, active and idempotency keys. OTP hashes, attempts and send counters live in their own table. |
| Agent API | `POST /v1/customer-invitations`, `POST /v1/customer-invitations/revoke` | `X-Vision-Key` = `VISION_AUTOMATION_KEY`, compared in constant time. |
| Customer API | `POST /v1/link-exchanges/invitations/{resolve,code,verify,open}` | Token in the body only. Shares the stricter auth rate limit and the HttpOnly trusted-device cookies of `/v1/link-exchanges`. |
| Legacy links | `POST /v1/link-exchanges` | Signed customer links now return `invitation_required` (a 30-minute invitation for the booking's primary customer) instead of a session. |
| Step-up | `POST /v1/link-exchanges/step-up` (Bearer) | Gives an unverified session a 15-minute invitation so it can confirm by email; the old session is ended on success. |
| Development | `GET/POST /v1/link-exchanges/dev-invitation` | 404 when `NODE_ENV=production`. Uses `VISION_DEV_*` on the server. |
| Contracts | `packages/contracts/src/invitations.ts` | Zod schemas for every new request and response, used by the API (requests and responses) and the app (responses). |
| App | `apps/mobile/src/app/features/invitation/invitation-flow.ts` | Welcome → send code → enter code → verified trip → My Trips. |

### Tokens

* `vt_` + 24 bytes from `crypto.randomBytes` (192 bits), base64url. Links look like `https://<VISION_TRIP_LINK_BASE_URL>/vt_<token>`.
* Only `sha256(token)` is stored. The raw token is never written to SQLite, logs, the idempotency store or Airtable.
* Invitation responses and session-bearing routes are marked `@NoStoredReplay()`, so the generic `Idempotency-Key`
  store can never hold a link or a refresh token.

### Lifecycle and policies

* **Expiry**: `VISION_INVITATION_TTL_DAYS` (default 30, 1–90). Legacy-link invitations 30 minutes, step-up 15 minutes,
  share links 7 days, development 1 day.
* **Single use**: a successful verification consumes the invitation. Opening it again (on any device) shows
  "already used — ask your agent for a new invitation". Fellow-traveller *share* links are the only reusable kind.
* **One live agent link**: a new agent invitation for the same booking, customer and scope revokes the previous
  unused one, so a "resend" replaces the old link. The old link then reports `invitation_replaced` ("A newer
  invitation was sent…"), distinct from an agent's explicit revocation (`invitation_revoked`). Replacing a link never
  ends a session the customer already has. Invitations for different Bookings, or for different Customers on one
  Booking, are independent.
* **Duplicate automation deliveries** (explicit, tested policy):
  1. the same `idempotencyKey` for the same booking and customer returns `status: "duplicate"` with the original
     invitation id and **no second email** (and `url: null`, because the raw token is not stored);
  2. without a key, a second *email* request for the same booking, customer and scope within
     `VISION_INVITATION_DUPLICATE_WINDOW_SECONDS` (default 600) is also a duplicate;
  3. if the invitation email fails, nothing is issued and the key is freed, so a retry starts cleanly.
* **Revocation**: `POST /v1/customer-invitations/revoke` with `baseId`, `bookingRecordId` and optional
  `customerRecordId` revokes every unused invitation for it.
* **Re-validation**: every resolve, code send and verification re-reads the Booking and Customer. Unlinking the
  Customer or removing their email stops the invitation working.
* **Email changes**: each invitation stores a keyed hash of the email address it was created for. If the Customer's
  email changes before the invitation is used — before or after a code was sent — the invitation stops working with
  `destination_changed` and the agent sends a fresh one, which follows the new address. Invitations created before
  this change (no stored hash) follow the Customer's current email.

### Email codes

Six digits from `crypto.randomInt`, stored as `HMAC-SHA256(VISION_OTP_SECRET or VISION_LINK_SECRET, invitationId:code)`,
compared with `timingSafeEqual`. A code expires after 10 minutes; 5 wrong attempts invalidate it; a new code can be
requested after 60 seconds; at most 5 codes per invitation per hour and 10 per Customer per hour (across invitations).
A correct code *claims* the invitation atomically before the trip is loaded, so two concurrent submissions cannot both
succeed, and a used code cannot be replayed. If loading the trip fails after a correct code, the claim is released and
the same code can be retried.

### Sessions and sensitive actions

Sessions now record `customerRecordId`, `invitationId` and an **assurance** level:

| Assurance | Comes from | Sensitive actions |
|---|---|---|
| `otp` | email code | allowed |
| `trusted_device` | a device trusted after an earlier email code for this booking **and** customer | allowed |
| `link` | fellow-traveller share links | no (and fellow-traveller scope forbids them anyway) |
| `legacy` | every session created before this change | no — the app offers "Email me a code" (step-up) |

Quotation acceptance, payment links (scheduled and custom), sharing with a fellow traveller, the customer account
(view, preferences, opening another trip or quotation from it) return `403 { code: "verification_required" }` without
`otp`/`trusted_device`. Trip snapshots for unverified sessions omit stored payment-page URLs, so "Pay" always goes
through that check. Trips and quotations opened from a verified account inherit its assurance.

Trusted-device tokens are now bound to base, booking **and** customer (v2). Older booking-only tokens, which a postcode
answer could also earn, are ignored, so each device verifies by email once. **Decision:** they stay booking-specific.
Other bookings of the same Customer are reached from the authenticated Account page (no code needed there), so a
customer-wide trust token would add reach without adding convenience.

### Customer identity, accounts and branches

* **Identity root** = `Airtable Base ID + Customer Record ID`, taken from the verified session. The email address is
  only where codes are delivered. The Booking's rolled-up `Customers | Email` never selects Customer records.
* **Account discovery** (`GET /v1/trips/current/account`, related quotations): Bookings linked **both ways** to the
  verified Customer (Customer `Trips` lists the Booking *and* the Booking's `Customers` lists the Customer), in the
  session's base only, soft-deleted Bookings excluded. Listing a trip does not save it on the device.
* **Preferences** are read from and written to the verified Customer only.
* **Grouping duplicates** is opt-in: Customer records in the same base with the same non-empty `Customer Account ID`
  (text field on Customers; letters, digits and `. _ : -`) form one account for discovery and preferences. Matching
  emails never merge records, and Account IDs never reach across bases.
* **Opening an account trip** re-checks the link, then issues a session for that Booking, the same base and the
  verified Customer (or the grouped record the Booking is linked to), keeping the assurance. Unlinking a Booking stops
  future opening; trips already saved offline are left as they are.
* Sessions without a verified Customer (created before invitations) get `verification_required` from the account.
* Every session carries an opaque `identityKey` (`idk_…`, an HMAC of base + Customer; share links: base + booking). The
  app uses it to keep identities apart without seeing Airtable IDs.

### On the device (app)

* **My Trips** holds one saved copy per trip (`trp_…` = base + booking), so Branch A and Branch B never collide even
  with identical record IDs. Each copy records the `identityKey` that saved it. When a different Customer verifies
  the same Booking on the device, that identity **replaces** the copy, the app says so, and the previous identity's
  documents, notifications and checklist for that trip are cleared. A late refresh from the previous identity cannot
  overwrite the new owner's credential, and a token renewal never adopts another identity's session.
* Trusted-device tokens are stored per base + booking + Customer (native secure storage) or per cookie (browser), so
  a second person on a shared device does not evict the first.
* **Sign out of this account** ends the sessions and removes the saved trips of the open trip's identity (one
  Customer in one branch) and forgets that identity's trusted device; other branches and Customers stay.
  **Remove all data from this device** removes everything.
* Links opened while the app is running (`appUrlOpen`) or that launched it (`getLaunchUrl`) are accepted only as
  `https://<host>/trip/<token>`; set `--define VISION_TRIP_LINK_HOSTS="'trips.example.com'"` to restrict hosts. The
  open trip stays underneath the invitation screen; "Not now" returns to it.

### Fellow-traveller policy

* **Agent-created fellow-traveller invitations** (`scope: "fellow_traveller"`, sent to that Customer's email) **require
  an email code**, exactly like primary-customer invitations, and open the restricted fellow-traveller view.
* **Share links created by a verified lead customer** in the app are `vt_` invitations with `verification: none`:
  reusable for 7 days, no code, `link` assurance, fellow-traveller scope only (itinerary, documents and contacts; no
  prices, payments, acceptance or account).
* Legacy signed fellow-traveller links (≤ 7 days old when this ships) keep opening the restricted view until they expire.

## Airtable setup

### Fields on Bookings

| Field | Type | Notes |
|---|---|---|
| `App Invite Customer` | Link to Customers (one record) | The Customer to invite. Must be linked in the Booking's `Customers` field and have a Primary or Secondary Email. |
| `Send App Invite` | Checkbox (or Button) | The trigger. The script clears the checkbox. |
| `App Invite Status` | Single select | Options: `Sending`, `Sent`, `Link created`, `Already sent`, `Failed – choose one customer`, `Failed – customer not on booking`, `Failed – customer has no email`, `Failed – record not found`, `Failed – email not sent`, `Failed – automation not configured`, `Failed – try again`. |
| `App Invite Sent At` | Date with time (GMT) | Set from the API's `sentAt`. |
| `App Trip Link` | URL, optional | Only filled when the automation's `writeLink` input is `true` — for agents who need to paste the link into WhatsApp. Never build it with a formula. |
| `App Invite Requested At` | Formula, optional | `LAST_MODIFIED_TIME({Send App Invite})`. Makes Airtable's automatic retries idempotent. |

### Field on Customers (optional)

| Field | Type | Notes |
|---|---|---|
| `Customer Account ID` | Single line text | Leave empty by default. Give two or more Customer records in the **same base** the same value only when they are deliberately the same person (for example a duplicate created with an old email). They then share account discovery and preferences. Matching emails alone never do this. |

### Automation

1. **Trigger**: *When a record matches conditions* → Bookings → `Send App Invite` is checked.
2. **Action**: *Run a script* → paste [`docs/airtable/send-app-invite.js`](airtable/send-app-invite.js).
3. **Input variables**: `bookingRecordId` = *Airtable record ID* from the trigger; `apiUrl` = `https://<api-host>/v1`;
   optionally `scope`, `sendEmail` (`false` = link only), `writeLink` (`true` = fill `App Trip Link`).
4. **Secret**: store the API's `VISION_AUTOMATION_KEY` as the automation secret `VISION_AUTOMATION_KEY` (or, where
   secrets are unavailable, as a `visionKey` input variable typed in the automation UI). Never commit it.
5. Test with a booking whose customer uses your own email, then turn the automation on.

The script sends `base.id`, the Booking record ID and the selected Customer record ID; the API checks the link, the
email, sends the branded email, comments on the Booking (`📲 Customer App invitation emailed to gr***@…`), and the
script records the status, the send time and optionally the link, then clears the trigger. Failures set a `Failed – …`
status without exposing secrets. Every verification also adds a `✅ Customer verified…` comment.

## Environment (apps/api/.env)

| Variable | Purpose |
|---|---|
| `VISION_AUTOMATION_KEY` | Required for `/customer-invitations` (and existing notification automations). |
| `VISION_TRIP_LINK_BASE_URL` | Host and path of customer links, e.g. `https://app.example.com/trip`. Must be `https://` in production. |
| `VISION_INVITATION_TTL_DAYS` | Invitation lifetime, default 30. |
| `VISION_INVITATION_DUPLICATE_WINDOW_SECONDS` | Duplicate email window, default 600. |
| `VISION_OTP_SECRET` | Optional; code hashing key (defaults to `VISION_LINK_SECRET`). |
| `RESEND_API_KEY`, `VISION_EMAIL_FROM` | Invitation and code emails. Without a key, development prints them to the API console; production refuses. |
| `VISION_DEV_BASE_ID`, `VISION_DEV_BOOKING_RECORD_ID`, `VISION_DEV_CUSTOMER_RECORD_ID` | Development test trip only. Ignored in production. |

## Migration from signed links

* Existing signed customer links (`/trip/<payload>.<signature>/`, including those minted from `?member=&booking=`)
  keep working as **locators only**: the app exchanges them, receives `invitation_required`, and the customer verifies
  the booking's primary customer email (the linked Customer whose email matches `Customers | Email`, else the first
  linked Customer with an email). Bookings with no such Customer get "ask your travel agent for a new invitation".
* Existing app sessions keep working for viewing, refreshing and messaging, but are `legacy`: payments, acceptance,
  sharing and account changes prompt "Confirm it's you" → email code → a verified session that replaces the old one.
* `POST /v1/link-exchanges/local` (raw Base ID / Record ID) and the postcode / old OTP challenge endpoints are removed.
* Notification emails (`/v1/notifications/customer`) still contain signed links for now; they route into the code flow.
  Moving them to invitations is a follow-up.
* The PHP plugin is unchanged. Its trip pages (`/trip/<signed token>/`) keep their own gate. WordPress does not
  recognise `vt_` tokens, so the app must be served from its own host (VISION_TRIP_LINK_BASE_URL). If WordPress needs to
  issue app invitations later, it should call `POST /v1/customer-invitations` rather than mint tokens itself.
* Rotate `VISION_LINK_SECRET` twice once invitations are in use everywhere to retire every signed link.

## Local testing

1. In `apps/api/.env` set `AIRTABLE_TOKEN`, `VISION_LINK_SECRET`, and the three `VISION_DEV_*` values for a test
   Booking and a Customer linked to it whose email you can read (or leave `RESEND_API_KEY` empty to read codes from
   the API console).
2. `npm run start:api` and `npm run start:mobile`, open `http://localhost:4200`.
3. The entry screen shows **Open development test trip** (only in development builds, and only when the API reports the
   variables are valid; otherwise it shows the configuration problem). It runs the normal welcome → code → trip flow.
4. To test the agent path: `curl -X POST localhost:3000/v1/customer-invitations -H 'X-Vision-Key: …' -H 'Content-Type: application/json' -d '{"baseId":"app…","bookingRecordId":"rec…","customerRecordId":"rec…","sendEmail":false}'`
   and open the returned `url`.

## Security decisions and trade-offs

* Duplicate responses cannot return the link (only the hash is kept). Agents who lose it press the button again after
  the duplicate window, which issues a new link and revokes the old one.
* Single-use invitations mean a second device needs a new invitation (or the trusted first device). This is
  deliberate: a forwarded email cannot be used after the customer has opened it.
* Masked email hints and distinct "expired / used / replaced" messages are shown to anyone holding a valid token;
  unknown tokens get a generic "not valid".
* Share links stay possession-based (no code), limited to the fellow-traveller view and 7 days.
* Airtable attachment logo URLs in emails expire after a few hours (same as existing notification emails).
* Trips already saved on a device before this change may still hold stored payment-page URLs until their next refresh.
