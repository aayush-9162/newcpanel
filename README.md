# cpanel-modern

Modern rebuild of the existing EJS cpanel as a React + Express app.

- **server/** — Node + Express (TS). Thin proxy in front of the upstream MS SQL HTTP API at `http://192.168.68.8:3000/api/sql/select`. Hosts a named-query catalog so SQL never leaves the server.
- **web/** — React + Vite + TS + Tailwind. Talks only to `server/` via `/api/q/:name`.

## Run

```bash
npm install
npm run dev
```

Server runs on `:4000`, web on `:5173` (Vite proxies `/api` → `:4000`).

## Adding a new report

1. Add a query to [server/src/queries/index.ts](server/src/queries/index.ts) — give it a name, a Zod params schema, and a `build(params)` that returns `{ qry, values }`.
2. In the web app either point a route at the generic [ReportPage](web/src/components/ReportPage.tsx) with a config block, or build a bespoke page under [web/src/pages/](web/src/pages/).
3. Add it to [web/src/routes.ts](web/src/routes.ts) so it shows up in the sidebar.

## Environment

`server/.env` (copy from `.env.example`):
- `UPSTREAM_URL` — base URL of the upstream API (defaults to `http://192.168.68.8:3000`).
- `PORT` — server port (defaults to `4000`).
