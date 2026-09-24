CREATE TABLE IF NOT EXISTS retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

INSERT OR IGNORE INTO retailers (id, name, base_url) VALUES
  ('fnac', 'Fnac', 'https://www.fnac.com/'),
  ('king-jouet', 'King Jouet', 'https://www.king-jouet.com/'),
  ('carrefour', 'Carrefour', 'https://www.carrefour.fr/'),
  ('la-grande-recre', 'La Grande Récré', 'https://www.lagranderecre.fr/');

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  external_ref TEXT NOT NULL,
  ean TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  image_url TEXT,
  product_url TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  web_availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (web_availability IN ('available', 'unavailable', 'unknown')),
  discovered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (retailer_id, product_url)
);
CREATE INDEX IF NOT EXISTS products_ean_idx ON products(ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_last_seen_idx ON products(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  retailer_store_ref TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address TEXT,
  postal_code TEXT,
  city TEXT,
  region TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  source_url TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  UNIQUE (retailer_id, retailer_store_ref),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS stores_region_idx ON stores(region, city);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('in_stock', 'out_of_stock', 'unknown')),
  checked_at INTEGER NOT NULL,
  evidence_url TEXT,
  evidence_method TEXT,
  evidence_excerpt TEXT,
  confidence_score REAL,
  CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  CHECK (
    status = 'unknown'
    OR (
      store_id IS NOT NULL
      AND evidence_url IS NOT NULL
      AND substr(evidence_url, 1, 8) = 'https://'
      AND evidence_method IS NOT NULL
      AND evidence_method IN ('official_store_api', 'official_store_page', 'official_pickup_result')
      AND length(trim(coalesce(evidence_excerpt, ''))) > 0
      AND confidence_score IS NOT NULL
      AND checked_at > 0
    )
  ),
  CHECK (status <> 'unknown' OR confidence_score IS NULL)
);
CREATE INDEX IF NOT EXISTS observations_latest_idx ON observations(product_id, store_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  query TEXT NOT NULL CHECK (length(trim(query)) BETWEEN 1 AND 160),
  max_price_cents INTEGER CHECK (max_price_cents IS NULL OR max_price_cents BETWEEN 0 AND 500000),
  max_distance_km REAL NOT NULL CHECK (max_distance_km > 0 AND max_distance_km <= 200),
  origin_latitude REAL NOT NULL CHECK (origin_latitude BETWEEN -90 AND 90),
  origin_longitude REAL NOT NULL CHECK (origin_longitude BETWEEN -180 AND 180),
  retailer_ids_json TEXT NOT NULL CHECK (json_valid(retailer_ids_json) AND json_type(retailer_ids_json) = 'array'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_rules_installation_idx ON alert_rules(installation_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS source_state (
  source_id TEXT PRIMARY KEY,
  robots_checked_at INTEGER,
  robots_http_status INTEGER,
  robots_text TEXT,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_http_status INTEGER,
  last_error TEXT,
  product_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0)
);

