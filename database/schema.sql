create table if not exists products (
  id            bigint       primary key,
  slug          text         not null,
  name          text         not null,
  brand         text,
  category      text,
  sku           text,
  description   text,
  synced_at     timestamptz  not null default now()
);

create extension if not exists pg_trgm;
create index if not exists products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index if not exists products_brand_idx     on products (brand);
create index if not exists products_category_idx  on products (category);

create table if not exists tracked_products (
  id                  uuid         primary key default gen_random_uuid(),
  product_id          bigint       not null references products (id) on delete restrict,
  product_slug        text         not null,
  product_name        text         not null,
  product_url         text         not null,
  is_active           boolean      not null default true,
  scrape_interval_minutes integer  not null default 120
                        check (scrape_interval_minutes between 5 and 10080),
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
  unique (product_id)
);

create index if not exists tracked_products_active_idx
  on tracked_products (is_active, last_attempt_at);

create table if not exists price_history (
  id                  bigserial    primary key,
  tracked_product_id  uuid         not null references tracked_products (id) on delete cascade,
  price               numeric(12,2) not null check (price > 0),
  currency            text         not null default 'INR',
  mrp                 numeric(12,2) check (mrp is null or mrp > 0),
  in_stock            boolean      not null,
  stock_qty           integer      check (stock_qty is null or stock_qty >= 0),
  scraped_at          timestamptz  not null default now()
);

create index if not exists price_history_product_time_idx
  on price_history (tracked_product_id, scraped_at desc);

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

create table if not exists scrape_logs (
  id                 bigserial    primary key,
  tracked_product_id uuid         not null references tracked_products (id) on delete cascade,
  run_id             uuid         references scrape_runs (id) on delete set null,
  attempt            integer      not null check (attempt >= 1),
  status             text         not null check (status in ('success','retried','failed')),
  error_code         text,
  error_message      text,
  http_status        integer,
  duration_ms        integer      not null default 0,
  scraped_price      numeric(12,2),
  scraped_in_stock   boolean,
  scraped_stock_qty  integer,
  structure_warning  text,
  layout_revision    bigint,
  started_at         timestamptz  not null default now(),
  completed_at       timestamptz
);

create index if not exists scrape_logs_product_time_idx
  on scrape_logs (tracked_product_id, started_at desc);
create index if not exists scrape_logs_status_idx on scrape_logs (status);
create index if not exists scrape_logs_run_idx    on scrape_logs (run_id);

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

alter table products         enable row level security;
alter table tracked_products enable row level security;
alter table price_history    enable row level security;
alter table scrape_runs      enable row level security;
alter table scrape_logs      enable row level security;
alter table alerts           enable row level security;
