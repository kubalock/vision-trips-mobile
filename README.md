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

## Mint payments

Mint credentials and the Airtable automation webhook remain in the Airtable `Brands & Branches` record (`Mint | API Key`, `Mint | Business Unit`, `Webhook URL`, allowed methods and custom-payment setting). The booking must contain a `Mint | Booking ID` beginning with `BK.`. Every generated Mint link includes that brand's HTTPS webhook URL. Mint posts successful payment data directly to Airtable; the mobile app then refreshes the Airtable-backed snapshot until the completed payment and receipt appear.
