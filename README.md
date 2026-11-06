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

Copy `apps/api/.env.example` to `apps/api/.env` before connecting to Airtable. Never expose the Airtable token to the mobile application.
