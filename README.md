# mydbtool

A desktop-feel web workbench for engineers to manage **MongoDB**, **PostgreSQL**, **MySQL**, and **Microsoft SQL Server** connections. Browse schemas or collections, preview rows, and run SQL or Mongo find/aggregate queries.

This is a practical MVP inspired by DBeaver — not a full clone. SSH tunnels, ER diagrams, import/export wizards, and multi-user cloud sync are out of scope.

## About

**mydbtool** is created and owned by **DerickWai (WMK)**.

**Built with love by DerickWai (WMK) and Grok Bot**

| | |
| --- | --- |
| **DerickWai (WMK)** | Author and owner |
| **Grok Bot** | Collaborator / assistant |

The workbench header and status bar show the same credit.

## Run locally

```bash
npm install
cp .env.example .env.local
# edit CONNECTIONS_SECRET in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The browser workflow is unchanged: you can keep using `npm run dev` / `npm start` if you do not want a desktop window.

## Desktop app (Electron)

The same Next.js workbench can run as a local desktop app. Electron only hosts the window; the Next.js Node server still handles API routes and the database drivers (`pg`, `mysql2`, `mssql`, `mongodb`). A static export is not used.

```bash
npm install
npm run electron:dev
```

That starts Next.js on a loopback port (preferring `127.0.0.1:39100`) and opens a native window titled **mydbtool**. DevTools open in development only.

| Script | Purpose |
| --- | --- |
| `npm run electron:dev` | Desktop shell + Next.js dev server |
| `npm run electron:preview` | Desktop shell against a production Next standalone build (`npm run build` first) |
| `npm run electron:build` | Production Next build + Electron package for the current OS |

Installers land in `release/` (gitignored):

| OS you build on | Typical artifacts |
| --- | --- |
| macOS | `.dmg` and `.zip` |
| Windows | NSIS installer and `.zip` |
| Linux | `.AppImage` and `.zip` |

Cross-compiling macOS/Windows from Linux is not supported here. Build on each OS (or OS-specific CI runners) for that platform’s installer. Builds are **unsigned**; macOS Gatekeeper / Windows SmartScreen will warn until you add signing certificates (a follow-up). Auto-update is also out of scope.

### Desktop data and secrets

In Electron, saved connections do **not** use `./data/connections.json` from the repo.

| Item | Location |
| --- | --- |
| Connection store | `<userData>/connections.json` |
| Password encryption secret | `<userData>/connections-secret.enc` when OS encryption (`safeStorage`) is available; otherwise `<userData>/connections-secret` (file mode `0600`) |

`userData` is typically:

- macOS: `~/Library/Application Support/mydbtool/`
- Windows: `%APPDATA%/mydbtool/`
- Linux: `~/.config/mydbtool/`

On startup the desktop shell generates a per-machine `CONNECTIONS_SECRET` (32 random bytes) if you did not export one, then passes it to the Next.js server. It is never hardcoded in the repository. Changing or deleting that secret file makes previously stored passwords undecryptable (same as changing `CONNECTIONS_SECRET` in browser mode).

To share one store between browser and desktop, export the same `CONNECTIONS_PATH` and `CONNECTIONS_SECRET` in the environment before launching either.

The packaged app bundles a Node.js runtime next to the Next standalone server so production `server.js` and the DB drivers run as Node, not in the renderer. The Next server binds to `127.0.0.1` only.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server (browser) |
| `npm run electron:dev` | Desktop app in development |
| `npm run electron:preview` | Desktop app using `npm run build` output |
| `npm run electron:build` | Package installers for the current OS |
| `npm run build` | Production web/standalone build (also used in CI) |
| `npm start` | Serve the production build in a browser |
| `npm test` | Unit tests (validation + query safety) |
| `npm run lint` | ESLint |

No live database is required to start the UI, save connections, or validate the connection form.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `CONNECTIONS_SECRET` | Recommended | Passphrase used to derive an AES-256-GCM key for encrypting saved passwords. If unset or shorter than 8 characters, a **development-only** default is used and a warning is logged (browser mode). The Electron app generates a per-machine secret under `userData` instead. Changing this value makes previously stored passwords undecryptable. |
| `CONNECTIONS_PATH` | Optional | File path for the connection store. Defaults to `./data/connections.json` in browser mode, or `<userData>/connections.json` in Electron. |

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

**Read-only** mode is per connection. SQL writes are rejected; Mongo only allows `find` and `aggregate`. Object-tree create/drop/rename actions (including databases) are also blocked. Destructive SQL in the editor (`DELETE`, `DROP`, `TRUNCATE`, `ALTER`) and GUI drop table/view/collection/column/database still require an explicit confirm dialog. Drop database also requires typing the catalog name.

## Using the workbench

1. Save a connection and optionally **Test connection**.
2. Select it in the sidebar to load the object tree (databases / schemas / tables, or databases / collections).
3. Click a table or collection to preview the first 100 rows (load more if truncated). Column/field types appear when the engine provides them.
4. Manage objects from the tree without writing SQL. Use the **⋮** button or right-click a node, or **New database** / **New table** / **New collection** in the Objects header:
   - **Databases**: create a catalog (`CREATE DATABASE` on SQL; Mongo creates the DB by inserting a first collection, default `_init`). Drop requires typing the name. Postgres and SQL Server refuse to drop/rename the database the connection itself opens (edit the connection to `postgres` / `master` first). The server runs those statements against a maintenance catalog (`postgres`/`template1`, `master`) so you are not inside the target. System catalogs (`postgres`/`template0`/`template1`, `mysql`/`sys`, `master`/`tempdb`, Mongo `admin`/`local`/`config`) cannot be dropped. Rename is available on Postgres and SQL Server only.
   - **SQL tables** (Postgres, MySQL, SQL Server): create a table (name, schema default `public` / `dbo` / none for MySQL, column list with type / nullable / PK), drop a table or view (danger confirm), rename a table, add or drop a column. The server validates identifiers, builds quoted DDL, and runs it with the existing driver. The tree refreshes on success.
   - **MongoDB collections**: create a collection (database + name), drop a collection (danger confirm), rename a collection.
   - **Read-only** connections disable these actions (menus still explain why). Destructive drops reuse the existing confirm dialog and must send `confirmDestructive` to `POST /api/connections/:id/manage`. Drop database also sends `confirmName`.
5. Open a query tab. SQL uses the editor + **Run** or **Ctrl/Cmd+Enter**. Statements run against the **active database** shown in the toolbar (`host · database`), defaulting to the saved connection database. Expanding another database in the object tree, opening a table preview, or using the toolbar selector (when several catalogs are listed) points SQL at that catalog so unqualified names match the tables you are browsing. Mongo already sends an explicit database on the find/aggregate tab.
6. Results show in a grid (and JSON for Mongo/preview). Row counts are capped (default 100, max 500).
7. Use **Dark / Light** in the header to switch theme. The choice is saved in `localStorage`. On a first visit, the workbench follows `prefers-color-scheme`. New object dialogs use the same theme tokens.

## Architecture

```
electron/                   Desktop shell (main, preload, splash)
scripts/                    Electron compile + Next standalone packaging
src/
  app/api/connections/     Node.js route handlers (CRUD, test, objects, preview, query, manage)
  lib/connections/         Validation, AES-GCM crypto, JSON file store
  lib/db/engines/          pg, mysql2, mssql (tedious), mongodb drivers
  lib/db/ddl.ts            Identifier-safe CREATE/DROP/RENAME SQL builders
  lib/db/query-safety.ts   Destructive / read-only helpers
  components/              Client workbench UI
```

- Next.js App Router + React. All driver I/O runs in server route handlers (`runtime = "nodejs"`).
- The Electron shell loads that server at `http://127.0.0.1` (dev server or production `output: "standalone"`). The renderer has `contextIsolation` and no `nodeIntegration`.
- Saved connections live in a local JSON file. Passwords are encrypted with `CONNECTIONS_SECRET`.
- Each request opens a short-lived driver connection and closes it. There is no arbitrary shell or filesystem access beyond that store file.
- SSH tunnels are not supported (future work).

## Safety notes

Treat this as a **local / trusted-network** tool. Anyone who can reach the app can use saved connections. Do not expose it to the public internet without additional authentication in front. The desktop build binds the Next.js server to `127.0.0.1` only.

## License

Private / unlicensed. **DerickWai (WMK)** owns this project unless a license is added.
