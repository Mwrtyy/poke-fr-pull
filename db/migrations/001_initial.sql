BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS retailers (
  id text PRIMARY KEY,
  name text NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES retailers(id),
  external_ref text NOT NULL,
  ean varchar(14),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  image_url text,
  product_url text NOT NULL,
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  web_availability text NOT NULL DEFAULT 'unknown' CHECK (web_availability IN ('available', 'unavailable', 'unknown')),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, external_ref),
  UNIQUE (retailer_id, product_url)
);
CREATE INDEX IF NOT EXISTS products_ean_idx ON products(ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_last_seen_idx ON products(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES retailers(id),
  retailer_store_ref text NOT NULL,
  name text NOT NULL,
  address text,
  postal_code text,
  city text,
  region text,
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location extensions.geography(Point, 4326),
  source_url text NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (retailer_id, retailer_store_ref),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS stores_region_idx ON stores(region, city);
CREATE INDEX IF NOT EXISTS stores_location_idx ON stores USING GIST(location);

CREATE TABLE IF NOT EXISTS observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('in_stock', 'out_of_stock', 'unknown')),
  web_availability text NOT NULL DEFAULT 'unknown' CHECK (web_availability IN ('available', 'unavailable', 'unknown')),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  checked_at timestamptz NOT NULL DEFAULT now(),
  evidence_url text,
  evidence_method text CHECK (evidence_method IS NULL OR evidence_method IN ('official_store_api', 'official_store_page', 'official_pickup_result', 'product_json_ld', 'product_html', 'catalog_feed')),
  evidence_excerpt text,
  confidence_score numeric(4, 3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status = 'unknown'
    OR (
      store_id IS NOT NULL
      AND evidence_url LIKE 'https://%'
      AND evidence_method IN ('official_store_api', 'official_store_page', 'official_pickup_result')
      AND length(btrim(coalesce(evidence_excerpt, ''))) > 0
      AND confidence_score IS NOT NULL
    )
  ),
  CHECK (status <> 'unknown' OR confidence_score IS NULL)
);
CREATE INDEX IF NOT EXISTS observations_product_checked_idx ON observations(product_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS observations_store_checked_idx ON observations(store_id, checked_at DESC) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS observations_status_checked_idx ON observations(status, checked_at DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  query text NOT NULL CHECK (length(btrim(query)) BETWEEN 1 AND 160),
  max_price_cents integer CHECK (max_price_cents IS NULL OR max_price_cents >= 0),
  max_distance_km numeric(6, 2) NOT NULL CHECK (max_distance_km > 0 AND max_distance_km <= 200),
  origin_latitude double precision CHECK (origin_latitude IS NULL OR origin_latitude BETWEEN -90 AND 90),
  origin_longitude double precision CHECK (origin_longitude IS NULL OR origin_longitude BETWEEN -180 AND 180),
  retailer_ids text[] NOT NULL CHECK (cardinality(retailer_ids) BETWEEN 1 AND 4),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((origin_latitude IS NULL) = (origin_longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS alert_rules_installation_idx ON alert_rules(installation_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_installation_idx ON push_subscriptions(installation_id);

CREATE TABLE IF NOT EXISTS sent_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, observation_id)
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES retailers(id),
  source_url text,
  run_kind text NOT NULL CHECK (run_kind IN ('discovery', 'catalog_check')),
  status text NOT NULL CHECK (status IN ('running', 'ok', 'blocked', 'failed', 'partial')),
  products_seen integer NOT NULL DEFAULT 0 CHECK (products_seen >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS monitor_runs_retailer_started_idx ON monitor_runs(retailer_id, started_at DESC);

INSERT INTO retailers (id, name, base_url) VALUES
  ('fnac', 'Fnac', 'https://www.fnac.com/'),
  ('king-jouet', 'King Jouet', 'https://www.king-jouet.com/'),
  ('carrefour', 'Carrefour', 'https://www.carrefour.fr/'),
  ('la-grande-recre', 'La Grande Récré', 'https://www.lagranderecre.fr/')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

COMMIT;
