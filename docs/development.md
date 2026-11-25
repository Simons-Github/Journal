# Development

## Requirements

Node.js 22.12 or newer (required by Vitest 5) and npm.

## Setup

```bash
npm install
cp .env.example .env          # set JWT_SECRET: openssl rand -hex 32
npm run db:start              # local Postgres via `prisma dev` (no Docker needed)
npx prisma migrate dev        # create the tables
npm run dev                   # app: http://localhost:5180, API: http://localhost:3001/api
```

The app also works without the API; it then stays local.

## Environment variables

See [`.env.example`](../.env.example) for the full list with comments.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled connection used by the API |
| `DATABASE_URL_UNPOOLED` | Direct connection used for migrations |
| `JWT_SECRET` | Required, at least 32 characters |
| `AI_KEYS_SECRET` | Optional. Encrypts stored user API keys; otherwise derived from `JWT_SECRET`. Changing it makes stored keys unreadable |
| `AI_SERVER_KEY_EMAILS` | Optional. Comma-separated addresses that may use server-side keys |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY` | Optional server keys, only for the addresses above |
| `AI_CHAT_MODEL`, `AI_IMPORT_MODEL`, `AI_VIDEO_MODEL` | Optional model overrides |
| `AI_DAILY_BUDGET_USD` | Optional default daily cost limit per user (default 1.00) |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the frontend (Vite) and the API together |
| `npm run dev:web` / `npm run dev:api` | Starts only one of them |
| `npm run db:start` | Starts the local Postgres |
| `npm run db:migrate` | Creates a new migration, applies it and regenerates the client |
| `npm test` | Runs the Vitest suite once (no database needed) |
| `npm run build` | Type-checks app and server, then builds for production |
| `npm run preview` | Serves the production build locally |

## Troubleshooting

| Symptom | Typical cause |
| --- | --- |
| API answers "Server nicht konfiguriert: JWT_SECRET ..." | `JWT_SECRET` is missing or shorter than 32 characters |
| `prepared statement already exists` locally | The local URL needs `pgbouncer=true&connection_limit=1`, as in `.env.example` |
| Sync shows "Server unreachable" | The API is not running; start everything with `npm run dev` |
| Vercel build fails at `prisma migrate deploy` | `DATABASE_URL_UNPOOLED` is missing in the Vercel project |
| Saving fails with "Workspace is too large" | The workspace is over 4 MB; export it and archive old entries |

## Database

| Table | Purpose |
| --- | --- |
| `users` | Email and bcrypt password hash |
| `workspaces` | The current workspace per user as one JSON document, with a version number |
| `workspace_versions` | Backups of earlier states, with the reason they were made |
| `auth_attempts` | Failed sign-in and sign-up attempts for rate limiting |
| `ai_usage` | Tokens and cost per AI assistant request, for the daily limit |
| `user_api_keys` | Each user's own AI API keys, encrypted (AES-256-GCM) |

Deleting an account removes its workspace, backups, AI usage records and API keys (cascade). Schema: [`prisma/schema.prisma`](../prisma/schema.prisma).

## Project structure

```
src/
├── pages/            # Today, journals, goals, projects, areas, tasks, habits, notes, study, books, settings
├── components/       # Editor dialogs, boards, task list, calendars, habit chart, shared UI
├── store.tsx         # Workspace state, sample data, derived values
├── sync.tsx          # Sign-in, upload, conflicts, backups
├── i18n.tsx          # English translations (German text is the key)
└── styles.css        # Design tokens and all styles
server/               # Express API: auth, workspace, AI assistant
server/generated/     # Prisma Client, generated on npm install (not versioned)
api/index.ts          # Vercel Function entry point
prisma/               # Schema and migrations
prisma.config.ts      # Prisma CLI config: migrations use DATABASE_URL_UNPOOLED
docs/screenshots/     # Images used in the README
```

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `npm ci`, `npm test` and `npm run build` on Node 22 for pushes and pull requests to `main`.

## Privacy details

- Your data lives in your browser and, if you register, in the Postgres database of the deployment.
- Keys for the AI assistant are stored encrypted, verified when saved and never sent back to the browser; only the last four characters are shown. Each user sets their own daily cost limit.
- The assistant (signed-in users only) sends what it looks up (notes, books, brain dump pages, tasks, projects, goals) plus your chat messages to Anthropic's Claude API. Journal entries and habits are not sent. Suggested tasks are saved only when you accept them. When you paste a link into the chat, the assistant can read that page and its course subpages; only addresses you wrote into the chat yourself, never addresses found on pages or in notes.
- The course import reads PDFs in your browser and sends only the extracted text to the Claude API; the file is not uploaded. Dates are planned by the app, and entries the AI could not quote from the material are flagged for review. Course links are fetched by the server (public https pages only; private and local addresses are blocked). YouTube playlists are read through the YouTube Data API; for a single video only its URL is sent to Google's Gemini API.
- Settings has JSON export and account deletion.
