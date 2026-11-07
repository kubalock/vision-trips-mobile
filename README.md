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
