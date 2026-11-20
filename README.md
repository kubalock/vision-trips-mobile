# Vision Trips Platform

Standalone mobile platform for Vision Trips. The existing WordPress plugin in `php-plugin/` is the behavioural reference and remains unchanged.

## Workspaces

- `apps/mobile` — Angular, Tailwind CSS and Capacitor customer application.
- `apps/api` — NestJS API and trusted Airtable/integration boundary.
- `packages/contracts` — framework-independent API contracts shared by both applications.

## Development

```sh
npm install
npm run start:api
npm run start:mobile
```

Copy `apps/api/.env.example` to `apps/api/.env` before connecting to Airtable. The API loads this file automatically in local development. Never expose the Airtable token to the mobile application.

Authentication sessions and pending verification challenges are stored in SQLite at `apps/api/.data/auth.sqlite` by default. Set `AUTH_DATABASE_PATH` to use a different persistent path. The database contains token hashes and OTP hashes, never the original tokens or codes. Back up or mount this path when running the API outside local development.

## Testing on a phone

The mobile app finds the API like this:

1. An explicit build-time URL always wins: `ng build --define 'VISION_API_URL="https://api.example.com/v1"'`. The installed iOS/Android app and production builds need this.
2. In a browser, it uses the host the page was opened from on port 3000. A phone on the same Wi-Fi can open `http://<your-computer's-IP>:4200` and reach the API on your computer with no extra setup.
3. Otherwise it uses `http://localhost:3000/v1`.

In development the API accepts requests from `localhost:4200`, from private-network addresses (10.x, 172.16–31.x, 192.168.x) and from the installed app (`capacitor://localhost`, `http(s)://localhost`). Production accepts only the origins listed in `MOBILE_ORIGIN`.

**Phone browser:** run `npm run start:api` and `npm run start:device --workspace @vision-trips/mobile`, then open `http://<your-computer's-IP>:4200` on the phone.

**Installed app (once `ios/` or `android/` has been added with `npx cap add`):**

```sh
npm run build:device --workspace @vision-trips/mobile   # bakes in http://<this Mac's Wi-Fi IP>:3000/v1
(cd apps/mobile && CAP_DEV=1 npx cap sync)              # allows plain HTTP for this local build only
```

The app sends API requests through Capacitor's native HTTP layer (`CapacitorHttp`), so browser CORS and mixed-content rules don't apply inside it. iOS still blocks plain HTTP to local addresses unless `NSAllowsLocalNetworking` is set in `Info.plist`.

## Store builds

```sh
VISION_API_URL=https://api.example.com/v1 npm run build:release --workspace @vision-trips/mobile
```

builds the production app for that API and copies it into `android/` and `ios/`. It refuses a missing, `http://` or local address, never includes the local-testing switches (`CAP_DEV`: plain HTTP and the `http://localhost` origin), and checks the synced config afterwards. Add `VISION_TRIP_LINK_HOSTS=trips.example.com` once the link domain exists. Then sign and upload from Android Studio (Build › Generate Signed App Bundle) and Xcode (Product › Archive). Signing keys and certificates stay out of git.

- **Versions** come from `apps/mobile/package.json`: `version` is what customers see, and the store build number is `major × 10000 + minor × 100 + patch` (1.2.3 → 10203), so raise the version for every upload. `VISION_BUILD_NUMBER` overrides the number for a re-upload of the same version.
- **Backups**: Android backup and phone-to-phone transfer are off. Saved sign-ins are encrypted with keys that never leave the phone, so a restored copy couldn't be used anyway. On a new phone, customers open their invitation link again.
- **iOS privacy manifest**: `apps/mobile/resources/ios/PrivacyInfo.xcprivacy` declares the data the app sends (names and phone numbers from traveller profiles and callbacks, messages to the agent, passport and licence details, the session identity, engagement events) and why plugins use `UserDefaults` and file dates. Keep it and the App Store privacy labels in step when data handling changes.
- All of this, like the icons and the background check, is applied to the native projects by `scripts/native-setup.mjs` on every `npx cap sync`.

## Logo and app icons

The Vision Trips mark, "Golden hour" (a map pin framing an amber sun setting on the horizon: any destination, however you travel there), has one source per use:

- `apps/mobile/public/brand/logo-mark.svg`: the mark on its rounded tile; the app draws the same artwork with `vt-logo-mark` (`apps/mobile/src/app/shared/logo-mark.ts`) and inline on the start-up screen in `index.html`.
- `apps/mobile/public/favicon.svg` and `favicon.ico`, `brand/apple-touch-icon.png`, `brand/icon-192.png`, `brand/icon-512.png`, `brand/icon-maskable-512.png` and `manifest.webmanifest`: browser tabs, home-screen bookmarks and installed web apps.
- `apps/mobile/resources/`: the native app's artwork. The SVGs are the sources; `npm run icons:render --workspace @vision-trips/mobile` renders the PNGs next to them (committed):
  - `icon.svg` → `icon-only.png`: the iOS app icon (full-bleed; iOS rounds the corners).
  - `icon-foreground.svg` + `icon-background.svg`: the Android adaptive icon (launchers crop it to a circle, squircle or square).
  - `splash.svg` / `splash-dark.svg`: launch screens, the same tile on the same background as the app's own start-up screen. Android 12+ draws its own launch screen from the app icon on `#f6f6f5` (`#121415` in dark mode).
  - `notification.svg` → `android/notification/`: Android's status-bar icon (white on transparent), used by phone notifications and the background check. iOS uses the app icon.
- `npx cap sync` (through `scripts/native-setup.mjs`) generates every native size with `@capacitor/assets` when that artwork changed or a platform was added, and copies the notification icon in, so `android/` and `ios/` never keep Capacitor's placeholder icons.

A travel agency's own logo still replaces the mark in the header when its trip is open.



Customers open a trip from an invitation link (`https://<host>/trip/vt_<token>`) and confirm it's them with a six-digit code emailed to the Customer the agent invited; the trip is then saved in My Trips. Agents create invitations from Airtable (`POST /v1/customer-invitations`, `X-Vision-Key`). The app never asks for Airtable IDs — in development, set `VISION_DEV_BASE_ID`, `VISION_DEV_BOOKING_RECORD_ID` and `VISION_DEV_CUSTOMER_RECORD_ID` in `apps/api/.env` and use **Open development test trip** on the entry screen. Older signed links still find the booking but now ask for an email code. See [docs/customer-app-invitations.md](docs/customer-app-invitations.md) for the Airtable fields and automation, environment variables, migration notes and security model.

## Where sessions are kept

- **Installed app:** the trip snapshot, its refresh token and the trusted-device tokens are kept in the device's secure storage (Keychain / Keystore).
- **Browser:** the app sends `X-Vision-Client: web`, and the API puts the refresh token and trusted-device tokens in `HttpOnly; SameSite=Strict` cookies (`Secure` in production), scoped to `/v1/sessions` and `/v1/link-exchanges` (which includes the invitation endpoints). The app only sees a `web:` handle that names the cookie. Access tokens stay in memory, and only the trip snapshot is saved, in IndexedDB, labelled "Saved in this browser".
- The browser keeps at most 30 session cookies (the least recently renewed are cleared first; that saved trip is then signed out in this browser but stays readable) and 20 trusted-device cookies (oldest first, as in the installed app), so the `Cookie` header can't keep growing.
- Sessions follow Airtable: every refresh, payment or share link, quotation acceptance and other write re-checks that the verified Customer still exists and is linked to the Booking both ways (and that a grouped duplicate still shares the same `Customer Account ID`). Reads reuse a check for up to a minute. When the link is gone, the session ends with 401 `access_revoked`, so live access stops within the 15-minute access-token window. The server keeps answering `access_revoked` for that session, and when the app hears it, it removes that trip from the device: the saved copy, downloaded documents, notifications, checklist and cached brand assets. (A device that stays offline keeps its copy until it next reaches the server.) An ordinary expiry or sign-out still keeps the saved copy readable. An Airtable outage doesn't sign anyone out. When an agent adds, changes or removes a Customer's `Customer Account ID`, the session moves to the new account: its next refresh returns the new identity and the app moves that identity's saved trips and trusted-device tokens with it. More than 20 Customer records under one `Customer Account ID` is refused (`account_group_too_large`), never silently truncated.
- Fellow-traveller share links last seven days, and so do the sessions opened from them: refreshing never extends a share session past its link's expiry. Revoking a booking's invitations (`POST /v1/customer-invitations/revoke` without a `customerRecordId`) also revokes its share links, which ends sessions already opened from them (`access_revoked`).
- Because the cookies are `SameSite=Strict`, the web app and the API must be served from the same site in production (for example `trips.example.com` and `api.example.com`).

## In-app and phone notifications

"Payment received", "Document ready" and the payment and departure reminders are worked out on the device by comparing two versions of a trip, with the rules in `packages/contracts/src/trip-notifications.ts`. Nothing is sent from the server yet (no push notifications).

- **While the app is open**, the trip is checked again when it starts, when the connection comes back, on **Refresh**, after a payment, and when the app returns to the foreground if the saved copy is more than 5 minutes old (the API's `nextRefreshAfter`).
- **While it isn't**, the installed app's background check (`apps/mobile/src/background/trip-watch.ts`, run by `@capacitor/background-runner`) asks `GET /v1/trips/current/watch` about every saved, signed-in trip. Android runs it every 15 minutes at the earliest and iOS when it chooses, and battery savers can delay it further. It shows what changed as a phone notification (when the customer turned them on) and hands it to the app, which adds it to the trip's list without showing it twice.
- The background check can't read the app's secure storage, and the session's refresh token rotates, so it uses its own read-only **watch token** (`POST /v1/trips/current/watch`). The token is tied to the session, works only while that session could still be refreshed, can read only the notification summary (payment states, document versions, dates, balance), and is limited to 12 checks an hour.
- `android/` and `ios/` aren't in git: `npx cap sync` runs `scripts/native-setup.mjs`, which adds what the plugin needs (the Android library path; iOS background modes, the task identifier and the `AppDelegate` registration). The runner script itself is built into `public/runners/` by `npm run build`.
- To test on the Android emulator without waiting: change something in Airtable (or wait for a reminder date), put the app in the background, and after the 15 minutes run `adb shell cmd jobscheduler run -f -n androidx.work.systemjobscheduler uk.co.visiontrips.app <job id>` (`adb shell dumpsys jobscheduler` shows the id). iOS never runs background tasks in the Simulator.

## Mint payments

Mint credentials and the Airtable automation webhook remain in the Airtable `Brands & Branches` record (`Mint | API Key`, `Mint | Business Unit`, `Webhook URL`, allowed methods and custom-payment setting). The booking must contain a `Mint | Booking ID` beginning with `BK.`. Every generated Mint link includes that brand's HTTPS webhook URL. Mint posts successful payment data directly to Airtable; the mobile app then refreshes the Airtable-backed snapshot until the completed payment and receipt appear.

## External content

External content is requested through the API, so flight, Places, Widgety and AI credentials never enter the mobile bundle. The Google Maps embed key is included only in restricted iframe URLs and should be locked to the app's allowed origins. Configure providers in `apps/api/.env`; Open-Meteo weather works without a key. Missing providers, rejected property matches and upstream failures are omitted without affecting the Airtable itinerary. Live flights refresh every three minutes, weather is cached for 30 minutes, Places and Widgety use longer positive and negative caches, and AI copy is generated asynchronously and quality-checked before display.

Customer section opens and action clicks are posted to the authenticated engagement endpoint. Set `AIRTABLE_ENGAGEMENT_TABLE` to append them to an Airtable table with `Booking`, `Event`, `Detail`, `Stage`, `When`, and `Device` fields; leave it blank to accept events without external logging. Provider configuration and cache counters are available at `GET /v1/health/providers`, and each external-content response includes redacted source diagnostics. Credentials and cached values are never returned.

Trip snapshots are read through a short in-memory cache. Concurrent requests for the same booking and view share one set of Airtable reads. Read endpoints (trip refresh, documents, calendar, external content) accept a complete snapshot up to 30 seconds old, while payment links, quotation acceptance and notification emails always read Airtable. A partial snapshot is never cached, and an acceptance or a payment change seen by the payment check clears that booking's cached copy. Brand records are kept for 5 minutes, suppliers for 10 and CMS reference records (airports, airlines, ships, operators, locations) for 30. The cache is per API process.

Operational controls use the same persistent SQLite database as sessions: fixed-window API rate limits survive restarts, the customer's writes (quotation acceptance, payment links, messages, preferences and engagement events) can be retried safely with `Idempotency-Key`. Replay is opt-in per route, the session is validated and re-checked before a stored reply is returned, a key only matches the same session (a token renewal keeps it; a new sign-in, a step-up or a share session is a different one) and the same path, query and body, and a request whose twin is still running gets 409 `idempotency_in_progress` so the app retries with the same key, and Airtable engagement writes run through a durable retry queue. Every response carries `X-Request-Id`, with one structured JSON request log containing method, path, status, and duration. In production, configure an explicit comma-separated `MOBILE_ORIGIN`, set `TRUST_PROXY` when behind a trusted reverse proxy, and opt into API documentation only with `ENABLE_API_DOCS=true`.

## Customer email automations

Set `RESEND_API_KEY`, `VISION_EMAIL_FROM`, `VISION_AUTOMATION_KEY` and `VISION_TRIP_LINK_BASE_URL` in `apps/api/.env`. Airtable automations can then call `POST /v1/notifications/customer` with the `X-Vision-Key` header and JSON containing `baseId`, `recordId`, `template` and an optional stable `idempotencyKey`. Supported templates are `balance_reminder`, `documents_issued`, `payment_received`, `welcome_home`, `quote_reminder` and `custom`. Custom messages also accept `subject`, `heading` and plain-text `body`.

The API always resolves the recipient from the booking, so this endpoint cannot be used as an arbitrary email relay. Successful deliveries are deduplicated in the durable SQLite store and recorded as comments on the Airtable booking. If email delivery succeeds but the Airtable comment fails, retrying the same request records the missing comment without resending the email.
