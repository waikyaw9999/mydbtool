# mydbtool

A desktop-feel web workbench for engineers to manage **MongoDB**, **PostgreSQL**, **MySQL**, and **Microsoft SQL Server** connections. Browse schemas or collections, preview rows, and run SQL or Mongo find/aggregate queries.

This is a practical MVP inspired by DBeaver — not a full clone. SSH tunnels, ER diagrams, import/export wizards, and multi-user cloud sync are out of scope.

## Run locally

```bash
npm install
cp .env.example .env.local
# edit CONNECTIONS_SECRET in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (also used in CI) |
| `npm start` | Serve the production build |
| `npm test` | Unit tests (validation + query safety) |
| `npm run lint` | ESLint |

No live database is required to start the UI, save connections, or validate the connection form.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `CONNECTIONS_SECRET` | Recommended | Passphrase used to derive an AES-256-GCM key for encrypting saved passwords. If unset or shorter than 8 characters, a **development-only** default is used and a warning is logged. Changing this value makes previously stored passwords undecryptable. |
| `CONNECTIONS_PATH` | Optional | File path for the connection store. Defaults to `./data/connections.json`. |

Passwords never leave the server after save. List/get APIs return `hasPassword`, not the secret. Connection strings are not sent to the browser.

## Engine setup

Add a connection from **New connection**. Defaults:

| Engine | Default port | Typical database | Notes |
| --- | --- | --- | --- |
| PostgreSQL (`postgres`) | 5432 | `postgres` / your DB | SSL uses `rejectUnauthorized=false` unless you set `rejectUnauthorized=true` in options. |
| MySQL (`mysql`) | 3306 | your schema | Same SSL option as Postgres. |
| SQL Server (`mssql`) | 1433 | your DB | `trustServerCertificate=true` by default (local/dev). Set `encrypt=true` for Azure. |
| MongoDB (`mongo`) | 27017 | optional | Use options for `authSource=admin`, `replicaSet=…`. Database is optional for local unauthenticated Mongo. |

Optional **connection options** accept either `key=value` lines or a JSON object.

Optional Docker stack for local servers:

```bash
docker compose up -d
```

Then create connections against `localhost` with:

- Postgres: `postgres` / `postgres` / database `demo`
- MySQL: `root` / `mysql` / database `demo`
- SQL Server: `sa` / `Your_password123`
- MongoDB: no auth, port `27017`

**Read-only** mode is per connection. SQL writes are rejected; Mongo only allows `find` and `aggregate`. Destructive SQL (`DELETE`, `DROP`, `TRUNCATE`, `ALTER`) also requires an explicit confirm dialog.

## Using the workbench

1. Save a connection and optionally **Test connection**.
2. Select it in the sidebar to load the object tree (databases / schemas / tables, or databases / collections).
3. Click a table or collection to preview the first 100 rows (load more if truncated). Column/field types appear when the engine provides them.
4. Open a query tab. SQL uses the editor + **Run** or **Ctrl/Cmd+Enter**. Mongo accepts a JSON find filter or an aggregation pipeline.
5. Results show in a grid (and JSON for Mongo/preview). Row counts are capped (default 100, max 500).

## Architecture

```
src/
  app/api/connections/     Node.js route handlers (CRUD, test, objects, preview, query)
  lib/connections/         Validation, AES-GCM crypto, JSON file store
  lib/db/engines/          pg, mysql2, mssql (tedious), mongodb drivers
  lib/db/query-safety.ts   Destructive / read-only helpers
  components/              Client workbench UI
```

- Next.js App Router + React. All driver I/O runs in server route handlers (`runtime = "nodejs"`).
- Saved connections live in a local JSON file. Passwords are encrypted with `CONNECTIONS_SECRET`.
- Each request opens a short-lived driver connection and closes it. There is no arbitrary shell or filesystem access beyond that store file.
- SSH tunnels are not supported (future work).

## Safety notes

Treat this as a **local / trusted-network** tool. Anyone who can reach the app can use saved connections. Do not expose it to the public internet without additional authentication in front.

## License

Private / unlicensed unless the repository owner adds one.
