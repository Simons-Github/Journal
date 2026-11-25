# Deployment

The app runs on Vercel. App and API share one Vercel project: the frontend as a static site, the API as a Function under `/api`. Every push to `main` deploys automatically.

1. Import the repository on vercel.com (Add New, Project). Leave Root Directory empty; framework, build command and output come from [`vercel.json`](../vercel.json).
2. Connect a database: Storage, Create Database, Neon (Postgres). This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. Set the secret: Settings, Environment Variables, `JWT_SECRET` = output of `openssl rand -hex 32`.
4. Deploy. The build runs `prisma migrate deploy` and creates the tables.

Via the CLI: `vercel link`, `vercel env add JWT_SECRET`, `vercel --prod`.

## Production checklist

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` point to the same Neon database.
- `JWT_SECRET` is set for Production and Preview (at least 32 characters; changing it signs everyone out).
- Custom domain added under Settings, Domains.
- `/api/health` answers `{"ok":true}`.
- AI features need no server key: every user adds their own keys under Settings, AI assistant. Optional variables are listed in [development.md](development.md#environment-variables).
- Registering and signing in work on the live domain.
