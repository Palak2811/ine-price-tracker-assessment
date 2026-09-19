-- ============================================================================
-- INE Product Price Tracker - Supabase / PostgreSQL schema
-- ============================================================================
-- Apply with: Supabase Dashboard -> SQL Editor -> paste -> Run
-- Safe to re-run: every object uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- products
--   Local cache of the mock store's catalogue (/api/catalog).
--   The catalogue endpoint returns name/brand/sku/category but NO price or
--   stock, so caching it is cheap and lets us serve partial-name search
--   without hammering the store on every keystroke.
-- ---------------------------------------------------------------------------
create table if not exists products (
  id            bigint       primary key,           -- store's own product id (stable)
  slug          text         not null,
  name          text         not null,
  brand         text,
  category      text,
  sku           text,
  description   text,
  synced_at     timestamptz  not null default now()
);

-- Partial/full name search. pg_trgm gives us fast case-insensitive ILIKE
-- '%foo%' matching, which a plain btree index cannot accelerate.
create extension if not exists pg_trgm;
create index if not exists products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index if not exists products_brand_idx     on products (brand);
create index if not exists products_category_idx  on products (category);

-- ---------------------------------------------------------------------------
-- tracked_products
--   A product the user has chosen to track. We deliberately store the store's
--   numeric id and slug (both stable) rather than relying on the display name,
--   so we can always rebuild the product URL even if the name changes.
-- ---------------------------------------------------------------------------
create table if not exists tracked_products (
  id                  uuid         primary key default gen_random_uuid(),
  product_id          bigint       not null references products (id) on delete restrict,
  product_slug        text         not null,
  product_name        text         not null,
  product_url         text         not null,
  is_active           boolean      not null default true,
  -- Bonus: configurable scrape frequency per product. The cron endpoint only
  -- scrapes a product when this interval has elapsed since last_scrape_at.
  scrape_interval_minutes integer  not null default 120
                        check (scrape_interval_minutes between 5 and 10080),
  -- Denormalised "last known good" snapshot. Written ONLY on a validated
  -- success, so a failed scrape can never overwrite valid data.
  last_price          numeric(12,2),
  last_currency       text,
  last_in_stock       boolean,
  last_stock_qty      integer,
  last_success_at     timestamptz,
  last_attempt_at     timestamptz,
  last_status         text         check (last_status in ('success','retried','failed')),
  last_error          text,
  consecutive_failures integer     not null default 0,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),
  -- One active tracking row per product.
  unique (product_id)
);

-- The cron endpoint filters on is_active and orders by staleness, so index both.
create index if not exists tracked_products_active_idx
  on tracked_products (is_active, last_attempt_at);

-- ---------------------------------------------------------------------------
-- price_history
--   One row per SUCCESSFUL, VALIDATED scrape. Never written on failure.
--   This is the series behind the price/stock chart.
-- ---------------------------------------------------------------------------
create table if not exists price_history (
  id                  bigserial    primary key,
  tracked_product_id  uuid         not null references tracked_products (id) on delete cascade,
  price               numeric(12,2) not null check (price > 0),
  currency            text         not null default 'INR',
  -- MRP / struck-through list price, when the page showed one. Nullable
  -- because it is genuinely absent on some renders.
  mrp                 numeric(12,2) check (mrp is null or mrp > 0),
  in_stock            boolean      not null,
  stock_qty           integer      check (stock_qty is null or stock_qty >= 0),
  scraped_at          timestamptz  not null default now()
);

create index if not exists price_history_product_time_idx
  on price_history (tracked_product_id, scraped_at desc);

-- ---------------------------------------------------------------------------
-- scrape_runs
--   One row per invocation of the cron endpoint or a manual scrape. Gives us
--   a run-level summary and lets us detect overlapping/duplicate cron calls.
-- ---------------------------------------------------------------------------
create table if not exists scrape_runs (
  id             uuid        primary key default gen_random_uuid(),
  trigger        text        not null check (trigger in ('cron','manual','cli')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  products_total integer     not null default 0,
  products_ok    integer     not null default 0,
  products_failed integer    not null default 0,
  notes          text
);

create index if not exists scrape_runs_started_idx on scrape_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- scrape_logs
--   One row per scrape ATTEMPT of a product (not per run). A product that
--   succeeded on attempt 3 produces three rows: failed, failed, success -- and
--   the product-level outcome is reported as 'retried'.
--   Failures are recorded honestly and are never deleted or hidden.
-- ---------------------------------------------------------------------------
create table if not exists scrape_logs (
  id                 bigserial    primary key,
  tracked_product_id uuid         not null references tracked_products (id) on delete cascade,
  run_id             uuid         references scrape_runs (id) on delete set null,
  attempt            integer      not null check (attempt >= 1),
  status             text         not null check (status in ('success','retried','failed')),
  -- Machine-readable failure bucket, e.g. 'timeout', 'gate_not_satisfied',
  -- 'price_missing', 'validation_failed', 'navigation_error'.
  error_code         text,
  error_message      text,
  http_status        integer,
  duration_ms        integer      not null default 0,
  -- Populated only when this attempt produced valid data.
  scraped_price      numeric(12,2),
  scraped_in_stock   boolean,
  scraped_stock_qty  integer,
  -- Bonus: page-structure change detection. Set when the layout revision
  -- changed or an internal consistency check looked wrong.
  structure_warning  text,
  layout_revision    bigint,
  started_at         timestamptz  not null default now(),
  completed_at       timestamptz
);

create index if not exists scrape_logs_product_time_idx
  on scrape_logs (tracked_product_id, started_at desc);
create index if not exists scrape_logs_status_idx on scrape_logs (status);
create index if not exists scrape_logs_run_idx    on scrape_logs (run_id);

-- ---------------------------------------------------------------------------
-- alerts  (bonus: price-drop / back-in-stock)
-- ---------------------------------------------------------------------------
create table if not exists alerts (
  id                 bigserial    primary key,
  tracked_product_id uuid         not null references tracked_products (id) on delete cascade,
  kind               text         not null check (kind in ('price_drop','back_in_stock','out_of_stock')),
  message            text         not null,
  old_price          numeric(12,2),
  new_price          numeric(12,2),
  acknowledged       boolean      not null default false,
  created_at         timestamptz  not null default now()
);

create index if not exists alerts_product_time_idx on alerts (tracked_product_id, created_at desc);
create index if not exists alerts_unack_idx on alerts (acknowledged, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tracked_products_set_updated_at on tracked_products;
create trigger tracked_products_set_updated_at
  before update on tracked_products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   The backend talks to Supabase with the service-role key, which bypasses
--   RLS. We still enable RLS with no permissive policies so that the anon key
--   (if it ever leaked into the frontend) cannot read or write these tables.
--   The frontend never talks to Supabase directly -- it goes through our API.
-- ---------------------------------------------------------------------------
alter table products         enable row level security;
alter table tracked_products enable row level security;
alter table price_history    enable row level security;
alter table scrape_runs      enable row level security;
alter table scrape_logs      enable row level security;
alter table alerts           enable row level security;
