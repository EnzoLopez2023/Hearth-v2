# Hearth-v2

Hearth-v2 is a standalone household and property fieldbook. It owns the daily dashboard, home maintenance, home inventory, yard maintenance, garden, pool maintenance, and recipes. It does not act as a portal for ShapePilot, Lantern, Marquee, Prism, Watchtower, or the legacy Hearth monolith.

## Run locally

Requires Node.js 24.

```sh
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. The development command runs Vite and Express together, explicitly enables the non-production development identity, and writes local data to `hearth-v2.db`. To exercise the built application:

```sh
npm run build
npm start
```

`npm run build` is the sole release decision. `npm test` runs focused informational tests for migrations, SQLite pragmas, validation, household ownership, QR preservation, idempotency, and legacy reconciliation.

## Architecture

The project is one TypeScript workspace:

- `src/client` — React 19, Vite, URL routing, the Property Fieldbook shell, dashboard, and reusable domain ledgers.
- `src/server` — Express 5 API, OIDC boundary, migration-managed SQLite, domain definitions, provider adapters, structured errors/logging, and graceful shutdown.
- `src/server/db/migrations.ts` — normalized household-owned schema and indexes.
- `src/server/legacy` — read-only deterministic legacy import and reconciliation.
- `tests` — synthetic focused backend evidence.

See [ARCHITECTURE.md](ARCHITECTURE.md), [PRODUCT.md](PRODUCT.md), and [DESIGN.md](DESIGN.md).

## API

All routes except the operational endpoints require an authorized household membership.

| Surface | Base route | Ledgers |
| --- | --- | --- |
| Dashboard | `/api/dashboard` | Aggregated maintenance, inventory, warranty, yard, garden, pool, recipe, and shopping attention |
| Home maintenance | `/api/maintenance` | items, tasks, warranties, photos, costs, insights |
| Home inventory | `/api/inventory` | categories, locations, sub-locations, items, images |
| Yard maintenance | `/api/yard` | locations, tasks, weather |
| Garden | `/api/garden` | fields, vegetables, beds, plantings, tasks, harvests, settings, shopping |
| Pool maintenance | `/api/pool` | reports, readings, recommendations, chemicals, insights |
| Recipes | `/api/recipes` | recipes, ingredients, images |
| Blobs | `/api/blobs` | authorized upload, read, and unreferenced deletion |
| QR/stable IDs | `/api/identifiers/:identifier` | household-scoped physical identifier resolution |

Each ledger supports list, get, create, patch, and delete operations with strict Zod validation, household-scoped references, audit records, structured failures, and optional `Idempotency-Key` replay protection.

Public operations:

- `GET /version.json` and `GET /api/version` — `BUILD_VERSION`, `SOURCE_SHA`, and `BUILD_TIME`.
- `GET /api/live` — process liveness.
- `GET /api/ready` — SQLite integrity and migration version plus non-blocking provider configuration status.

## Authentication and authorization

Development identity exists only when `DEV_AUTH_ENABLED=true` and `NODE_ENV` is not `production`. It seeds one deterministic local household/member for repeatable development. Production rejects that switch.

Production authentication is Microsoft Entra/OIDC-ready through `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI`. Tokens are verified against remote JWKS, then resolved to app-local users and household memberships. Protected APIs fail closed when OIDC is unconfigured; viewer memberships cannot mutate records. There are no shared legacy Hearth permissions.

The browser reads the non-secret tenant, client, and delegated scope configuration from `/auth-config.json`, obtains an Entra access token with MSAL, and attaches it to API requests. Production uses the app-local `access_as_user` scope; development identity remains server-only and cannot be enabled in production.

## Data and storage

SQLite is synchronous `better-sqlite3` with:

- `DB_PATH=hearth-v2.db` by default outside production.
- `DB_PATH=/home/data/hearth-v2.db` by default in production.
- `foreign_keys=ON`, `journal_mode=DELETE`, a five-second busy timeout, and `synchronous=FULL` in production.
- transactional ordered migrations recorded in `schema_migrations`.

Never use WAL for an Azure Files-backed database. Every user record is directly household-scoped or belongs to a household-scoped parent. Stable legacy IDs are retained as target IDs and recorded permanently in `legacy_identifier_map`, preserving printed HEARTH QR label resolution.

Blob authority is separate from the container filesystem. `BLOB_PROVIDER=local` with `LOCAL_BLOB_PATH` is available only outside production. Production local storage is forbidden; Azure Blob Storage uses the Web App managed identity with `AZURE_STORAGE_ACCOUNT_URL`, while a connection string remains a compatibility fallback. Optional AI and weather/geocoding adapters never block readiness.

## Legacy migration

Legacy Hearth remains authoritative. Do not point this command at live data without backups and an approved migration window.

```sh
npm run legacy:import -- \
  --source /absolute/path/to/hearth.db \
  --household hsh_destination \
  --namespace approved-snapshot-2026-08
```

The importer opens the source read-only with `query_only=ON`, recognizes only Hearth-v2-owned tables, applies explicit field mappings, preserves stable source IDs, canonicalizes and hashes every source table, records counts/hashes in reconciliation tables, and commits the entire import in one transaction. Embedded recipe, maintenance, inventory, and pool-report files are staged through the configured durable blob provider with deterministic identities and verified by readback before database rows are committed. An exact restart verifies both reconciliation evidence and stored blobs before returning a no-op. Changed snapshots, identifier collisions, schema drift, missing required fields, or any row failure abort the whole import.

External image URLs, filesystem paths, warranty documents, and receipt paths are refused because they are not contained in the SQLite snapshot. Production blob authority is never imported into the container filesystem.

All fixtures are synthetic. This repository contains no production or personal data.

## Containers and future deployment

```sh
docker build -t hearth-v2:local .
docker run --rm -p 3000:3000 \
  -e DEV_AUTH_ENABLED=true \
  -e NODE_ENV=development \
  -v "$PWD/.local-data:/home/data" \
  hearth-v2:local
```

The Dockerfile and `.github/workflows/deploy.yml` publish a linux/amd64 candidate tagged by source SHA and workflow run, pin App Service to the resolved digest, and promote `hearth-v2:latest` only after the exact build is live and ready. Production still requires durable `/home/data`, app-local OIDC values, and managed-identity Blob configuration. Deployment does not cut over DNS, import legacy data, or mutate legacy Hearth or Hearth-for-iOS.
