# INE Product Price Tracker

Tracks prices and stock for products on INE's hosted mock store
(<https://demo.inelabteamdev.com>) by scraping them on a fixed 2-hour schedule,
and shows the price history, stock history and a per-product scrape log.

The store is deliberately hard to scrape — rotating CSS class names, three decoy
prices, zero-width characters inside the digits, a proof-of-work + WASM +
browser-attestation gate on the price API, and injected slowness and errors. The
scraper is the point of this project; the UI is deliberately plain.

> **Reliability, measured against the live store.** A deliberately naive first
> pass scored 8 successes / 6 failures over 16 products. After the fixes
> described in [`docs/DESIGN.md`](docs/DESIGN.md), the same harness scored
> **12/12 with zero retries**, and the run time fell from 298s to 112s.

---

## Contents

1. [Architecture](#architecture)
2. [Tech stack](#tech-stack)
3. [How the scraper works](#how-the-scraper-works)
4. [Local setup](#local-setup)
5. [Supabase setup](#supabase-setup)
6. [Database schema](#database-schema)
7. [Environment variables](#environment-variables)
8. [Running everything](#running-everything)
9. [Headed (observable) run](#headed-observable-run)
10. [Scheduled scraping](#scheduled-scraping)
11. [API reference](#api-reference)
12. [Testing](#testing)
13. [Deployment](#deployment)
14. [Scraping reliability strategy](#scraping-reliability-strategy)
15. [Known limitations](#known-limitations)

---

## Architecture

```
┌──────────────┐        ┌──────────────────────────────┐        ┌────────────┐
│   Browser    │ HTTPS  │   Express API  (Render)      │        │  Supabase  │
│  React SPA   │───────▶│                              │───────▶│ PostgreSQL │
│  (Vercel)    │        │  routes → controllers →      │        └────────────┘
└──────────────┘        │  services → repositories     │
                        │                ↓             │
┌──────────────┐  POST  │         scraper (Playwright) │        ┌────────────┐
│ cron-job.org │───────▶│                              │───────▶│ mock store │
│  every 2h    │ secret │                              │        └────────────┘
└──────────────┘        └──────────────────────────────┘
```

Scheduling is **external on purpose**: Render's free tier sleeps, so an
in-process timer would stop with it and silently never fire again.

```
backend/
  src/
    config/        environment loading + fail-fast validation
    routes/        path → controller mapping only
    controllers/   HTTP shape: parse, validate, respond
    services/      business logic and orchestration
    repositories/  all Supabase access
    scraper/       constants, layout, browser, extract, parse, scrapeProduct
    middleware/    errors, validation, cron auth, rate limiting
    utils/         logger, retry/backoff, ApiError
  scripts/         CLI entry points (sync catalogue, scrape, headed scrape)
  tests/           unit tests
frontend/src/      pages, components, api client
database/          schema.sql
docs/              DESIGN.md
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + React Router + Recharts → **Vercel** |
| Backend | Node 20 + Express → **Render** |
| Database | **Supabase** PostgreSQL |
| Scraping | Playwright (Chromium) for price/stock; plain `fetch` for the catalogue |
| Scheduling | **cron-job.org**, every 2 hours |
| Tests | Vitest |

---

## How the scraper works

**Lightweight HTTP where possible, a browser only where required.** The store's
JSON API gives us the catalogue for free, but it deliberately withholds price and
stock. Those require a real browser — the full reasoning, with evidence, is in
[`docs/DESIGN.md`](docs/DESIGN.md §1).

Per product, per attempt:

1. `GET /api/layout` → the **current** CSS class names (they rotate ~every 40 min).
2. Navigate to `/product/:id`.
3. Dismiss the cookie banner if present — it intercepts pointer events.
4. **Arm the interaction gate**: ≥8 real mouse moves plus dwell, because the
   Reveal button stays disabled until the store sees them.
5. Click Reveal with a **trusted** event, then poll, distinguishing
   `idle` / `loading` / `retrying` and re-clicking only when genuinely idle.
6. Extract using the layout's `priceValue` class, visible elements only.
7. Strip zero-width characters, parse, validate, and check against the decoys.

Failures write a log row and nothing else. A price is stored only when it passes
every check.

---

## Local setup

**Prerequisites:** Node 20+, npm, and a free Supabase project.

```bash
git clone <your-repo-url>
cd college-placement-project
```

```bash
cd backend && npm install
```

`npm install` runs `playwright install chromium` via postinstall (~150MB). If
that download times out, rerun it on its own:

```bash
cd backend && npx playwright install chromium
```

```bash
cd frontend && npm install
```

---

## Supabase setup

1. Create a project at <https://supabase.com> (free tier).
2. Open **SQL Editor → New query**, paste all of
   [`database/schema.sql`](database/schema.sql), and **Run**. It is idempotent —
   safe to re-run.
3. Copy **Project URL** and the **`service_role`** key from
   **Settings → API**.

> **The `service_role` key bypasses Row Level Security.** It belongs only in
> `backend/.env`, which is gitignored. It must never reach the frontend or a
> commit. RLS is enabled on every table with no permissive policies, so even a
> leaked anon key cannot read this data.

Then populate the local catalogue mirror (~1000 products, one-off, ~30s):

```bash
cd backend && npm run sync:catalog
```

---

## Database schema

| Table | Purpose |
|---|---|
| `products` | Catalogue mirror; backs partial-name search (`pg_trgm` GIN index) |
| `tracked_products` | What we track + **last known good** price/stock snapshot |
| `price_history` | One row per **successful, validated** scrape — never on failure |
| `scrape_logs` | One row per **attempt**, success or failure — the honest log |
| `scrape_runs` | One row per cron/manual invocation; powers the overlap guard |
| `alerts` | Price-drop / back-in-stock events (bonus) |

The separation between `price_history` and `scrape_logs` is what makes the
history honest: a product that succeeded on attempt 3 leaves **three**
`scrape_logs` rows (failed, failed, success) and exactly **one** `price_history`
row.

---

## Environment variables

### `backend/.env` (see `backend/.env.example`)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key. **Server-only.** |
| `CRON_SECRET` | yes | Shared secret for the cron endpoint. ≥24 chars in production. |
| `CORS_ORIGINS` | no | Comma-separated allow-list. Default `http://localhost:5173` |
| `PORT` | no | Default `8080` |
| `NODE_ENV` | no | Default `development` |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`. Default `info` |
| `SCRAPE_CONCURRENCY` | no | Products in parallel. Default `2`, capped at 5 |

Generate a cron secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `frontend/.env` (see `frontend/.env.example`)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL, e.g. `http://localhost:8080` |

Vite exposes only `VITE_`-prefixed variables to the browser. **Nothing secret
goes in the frontend** — it never talks to Supabase directly.

---

## Running everything

Backend (terminal 1):

```bash
cd backend && npm run dev
```

Frontend (terminal 2):

```bash
cd frontend && npm run dev
```

Then open <http://localhost:5173>, go to **Add product**, search e.g.
`microphone`, and click **Track**.

Scrape from the CLI:

```bash
cd backend && npm run scrape           # only products that are due
cd backend && node scripts/scrape-cli.js --all   # ignore the schedule
```

---

## Headed (observable) run

Watch the scraper work in a visible browser:

```bash
cd backend && npm run scrape:headed
```

That runs `scrape-cli.js --headed --slow-mo=350`, which:

- launches Chromium **visibly**,
- scrapes **sequentially** so it is watchable,
- slows actions by 350ms so the mouse-move gate and Reveal click are visible,
- prints each attempt, retry and backoff to the console.

Useful flags:

```bash
node scripts/scrape-cli.js --headed --all --slow-mo=500
node scripts/scrape-cli.js --headed --product=<tracked-uuid>
```

Set `LOG_LEVEL=debug` to also see gate arming and retry decisions.

**Headed mode is for development and demos only.** Production scraping always
runs headless — there is no display on Render.

### Forcing a failure on camera

The recording has to show a slow or failing response. Shrink a timeout to force
a genuine one — no data is faked and the store is not stubbed:

```bash
SCRAPE_RESOLVE_TIMEOUT_MS=250 LOG_LEVEL=debug npm run scrape:headed
```

That produces three real failed attempts with exponential backoff between them,
after which the UI shows the failure, the **preserved** last-good price, and the
new failure rows in the log.

| Variable | Forces a failure during |
|---|---|
| `SCRAPE_RESOLVE_TIMEOUT_MS` | waiting for the price to resolve |
| `SCRAPE_GATE_TIMEOUT_MS` | arming the mouse-move gate |
| `SCRAPE_NAVIGATION_TIMEOUT_MS` | page navigation |
| `SCRAPE_BLOCK_TIMEOUT_MS` | waiting for the price block |

A full shot list is in [`docs/DEMO-RECORDING.md`](docs/DEMO-RECORDING.md).

---

## Scheduled scraping

**Schedule: once every 2 hours** (12 runs/day), matching the assignment.

### Configure cron-job.org

1. Create a free account at <https://cron-job.org>.
2. **Create cronjob**:
   - **URL**: `https://<your-render-service>.onrender.com/api/cron/scrape`
   - **Schedule**: *Every 2 hours* — or custom: minute `0`, hours
     `0,2,4,6,8,10,12,14,16,18,20,22`
   - **Request method**: `POST`
   - **Headers**: `Authorization: Bearer <your CRON_SECRET>`
     (or `X-Cron-Secret: <your CRON_SECRET>`)
   - **Request timeout**: raise to the maximum (30s) — a cold Render instance
     takes time to wake.
3. Save and use **Test run** to verify.

The secret is **never** accepted as a query parameter, because query strings end
up in access logs.

### Keeping the instance warm (optional)

A second cron hitting `GET /health` every 10–14 minutes stops the free instance
sleeping, so the 2-hourly scrape does not pay a cold start.

### Behaviour

- Scrapes every **active** tracked product whose interval has elapsed.
- One product failing does **not** abort the run.
- If a run is already in flight it returns `200 {"skipped": true}` rather than
  double-scraping. 200 is deliberate: a non-2xx tells cron to retry, and retrying
  a half-finished run would double-write history.

---

## API reference

Base path `/api`. All responses are JSON; errors are
`{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/products/search?q=&limit=` | Partial/full name, brand or SKU search |
| `GET` | `/products/:id` | One catalogue product |
| `GET` | `/tracked-products` | Dashboard list |
| `POST` | `/tracked-products` | Track one. Body `{ productId, scrapeIntervalMinutes? }` |
| `GET` | `/tracked-products/:id` | Detail + history + logs + stats |
| `DELETE` | `/tracked-products/:id` | Stop tracking (soft; `?hard=true` to purge) |
| `PATCH` | `/tracked-products/:id/interval` | Change scrape frequency (bonus) |
| `GET` | `/tracked-products/:id/history` | Price/stock history |
| `GET` | `/tracked-products/:id/logs` | Scrape log (`?status=failed` to filter) |
| `POST` | `/tracked-products/:id/scrape` | Manual scrape (rate limited: 5/min/IP) |
| `POST` | `/cron/scrape` | **Secret required.** Scheduled scrape |
| `POST` | `/cron/sync-catalog` | **Secret required.** Refresh the catalogue mirror |
| `GET` | `/cron/runs` | **Secret required.** Recent run summaries |
| `GET` | `/health` | Health check (outside `/api`) |

**The scraper only ever accepts a product id, never a URL.** URLs are built
server-side and every navigation passes through an origin check that rejects
anything that is not `https://demo.inelabteamdev.com`.

---

## Testing

```bash
cd backend && npm test          # unit tests
cd backend && npm run test:watch
```

Unit tests cover the parsing and validation logic against **real strings
captured from the live store**, including the zero-width padded digits, all five
stock phrasings, the `Rs. 12,723.00` format that broke an early parser, and the
rule that a missing element is *not* "out of stock".

Integration check against the live store (no database needed):

```bash
cd backend && node scripts/probe-scraper.js 325 174 2 42 500
```

It prints per-attempt outcomes and a success/retry/failure summary.

---

## Deployment

### 1. Supabase
Follow [Supabase setup](#supabase-setup). Run `npm run sync:catalog` once.

### 2. Backend → Render

- **New → Web Service**, connect the repo.
- Root directory `backend`; runtime Node.
- Build: `npm ci` (the postinstall hook downloads Chromium)
- Start: `npm start`
- Health check path: `/health`
- Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
  `CORS_ORIGINS` (your Vercel URL), `NODE_ENV=production`, and
  `PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright`.

[`render.yaml`](render.yaml) declares all of this; secrets are `sync: false` so
they are entered in the dashboard rather than committed.

> The free tier has 512MB RAM. Chromium fits at `SCRAPE_CONCURRENCY=2`; raising
> it risks OOM.

### 3. Frontend → Vercel

- **Add New → Project**, import the repo.
- Root directory `frontend`; framework preset **Vite**.
- Environment: `VITE_API_BASE_URL=https://<your-render-service>.onrender.com`
- Deploy, then add the resulting Vercel URL to `CORS_ORIGINS` on Render and
  redeploy the backend.

### 4. Cron
Follow [Scheduled scraping](#scheduled-scraping).

### 5. Verify

```bash
curl https://<render-service>.onrender.com/health
curl -X POST https://<render-service>.onrender.com/api/cron/scrape \
     -H "Authorization: Bearer <CRON_SECRET>"
```

---

## Scraping reliability strategy

1. **Never hardcode a rotating selector.** Class names come from `/api/layout`
   every run. A missing class key fails loudly rather than extracting nothing.
2. **Select only the real price element**, never `sale` — `"Deal price ₹X"` is a
   *visible* decoy.
3. **Visibility filtering** removes the two hidden decoys, including the
   `[data-price]` bait.
4. **Decoy tripwire**: if the extracted value equals a known decoy, fail the
   scrape instead of storing a plausible wrong price.
5. **Two retry layers**: the store's internal 6, and ours — 3 attempts,
   exponential backoff, ±30% jitter so parallel products do not retry in lockstep.
6. **Typed errors** with a `retryable` flag; a 404 is never retried.
7. **Validate before storing.** A missing element is *not* "out of stock" — it is
   a failure.
8. **Failures never corrupt data**: no history row, and the last known good price
   is preserved and shown as explicitly stale.
9. **Overlap guards** at run level and per-product due-time level.
10. **Structure-change detection** watches `layout.revision` and surfaces changes.

Full reasoning, including two approaches that were measured and **rejected**, is
in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Known limitations

- **Throughput.** ~5–12s per product at concurrency 2 means roughly 20–25
  products per 2-hour window. Beyond that, shard across multiple cron schedules.
- **Cold starts.** A sleeping Render instance adds 30–60s to the first cron call.
  Mitigate with a `/health` warm-up ping.
- **Store changes.** The browser flow absorbs changes to the attestation scheme,
  but a change to the `price-block` markup or the `/api/layout` contract would
  need a code change.
- **No authentication.** Single-tenant by design. The cron endpoint is
  secret-protected and manual scrape is rate-limited; read endpoints are public.
- **Structure-change detection reports, it does not adapt.** Reacting to a
  `layout.revision` change is a human decision.
