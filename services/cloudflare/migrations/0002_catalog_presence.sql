ALTER TABLE products ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 1 CHECK (catalog_active IN (0, 1));
CREATE INDEX IF NOT EXISTS products_catalog_active_idx ON products(retailer_id, catalog_active, last_seen_at DESC);
