import { pool, query } from "./db.js";
import { validateStoreSignal } from "./evidence.js";
import type { RetailerProduct, StoreObservation } from "./contracts.js";

export async function saveUnknownProduct(product: RetailerProduct) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const productId = await upsertProductWithClient(client, product);
    await client.query(
      `INSERT INTO observations (product_id, store_id, status, web_availability, price_cents, checked_at, raw_metadata)
       VALUES ($1, NULL, 'unknown', $2, $3, $4, $5::jsonb)`,
      [productId, product.webAvailability, product.priceCents, product.discoveredAt, JSON.stringify({ sourceUrl: product.sourceUrl, storeStatus: "unknown" })],
    );
    await client.query("COMMIT");
    return productId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveStoreObservation(input: StoreObservation) {
  const validation = validateStoreSignal({
    status: input.status,
    storeRef: input.store?.retailerStoreRef ?? null,
    evidence: input.evidence,
    checkedAt: new Date(input.checkedAt),
  });
  if (!validation.valid) throw new Error(`Rejected store observation: ${validation.reason}`);
  if (!input.store || !input.evidence) throw new Error("Store and evidence are required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const storeResult = await client.query<{ id: string }>(
      `INSERT INTO stores (retailer_id, retailer_store_ref, name, address, postal_code, city, region, latitude, longitude, location, source_url, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $8::double precision IS NULL THEN NULL ELSE extensions.ST_SetSRID(extensions.ST_MakePoint($9::double precision,$8::double precision),4326)::extensions.geography END,
         $10,$11)
       ON CONFLICT (retailer_id, retailer_store_ref) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, postal_code = EXCLUDED.postal_code,
         city = EXCLUDED.city, region = EXCLUDED.region, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         location = EXCLUDED.location, source_url = EXCLUDED.source_url, verified_at = EXCLUDED.verified_at
       RETURNING id`,
      [input.product.retailerId, input.store.retailerStoreRef, input.store.name, input.store.address, input.store.postalCode, input.store.city, input.store.region, input.store.latitude, input.store.longitude, input.evidence.url, input.checkedAt],
    );
    const productId = await upsertProductWithClient(client, input.product);
    const previous = await client.query<{ status: string; checked_at: Date }>(
      `SELECT status, checked_at FROM observations WHERE product_id=$1 AND store_id=$2 ORDER BY checked_at DESC LIMIT 1`,
      [productId, storeResult.rows[0].id],
    );
    const observation = await client.query<{ id: string }>(
      `INSERT INTO observations (product_id, store_id, status, web_availability, price_cents, checked_at, evidence_url, evidence_method, evidence_excerpt, confidence_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [productId, storeResult.rows[0].id, input.status, input.product.webAvailability, input.product.priceCents, input.checkedAt, input.evidence.url, input.evidence.method, input.evidence.excerpt, validation.confidence],
    );
    await client.query("COMMIT");
    const last = previous.rows[0];
    const isFreshTransition = input.status === "in_stock" && (!last || last.status !== "in_stock" || Date.now() - new Date(last.checked_at).getTime() > 15 * 60_000);
    if (isFreshTransition) {
      const { dispatchConfirmedStockAlert } = await import("./notifications.js");
      await dispatchConfirmedStockAlert(observation.rows[0].id);
    }
    return { productId, storeId: storeResult.rows[0].id, observationId: observation.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertProductWithClient(client: import("pg").PoolClient, product: RetailerProduct) {
  const externalRef = product.retailerSku ?? product.ean ?? product.productUrl;
  const result = await client.query<{ id: string }>(
    `INSERT INTO products (retailer_id, external_ref, ean, title, image_url, product_url, price_cents, web_availability, discovered_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (retailer_id, external_ref) DO UPDATE SET title=EXCLUDED.title, ean=COALESCE(EXCLUDED.ean, products.ean),
       image_url=COALESCE(EXCLUDED.image_url, products.image_url), product_url=EXCLUDED.product_url,
       price_cents=COALESCE(EXCLUDED.price_cents, products.price_cents), web_availability=EXCLUDED.web_availability, last_seen_at=now()
     RETURNING id`,
    [product.retailerId, externalRef, product.ean, product.title, product.imageUrl, product.productUrl, product.priceCents, product.webAvailability, product.discoveredAt],
  );
  return result.rows[0].id;
}

export async function startMonitorRun(retailerId: string, sourceUrl: string | null, kind: "discovery" | "catalog_check") {
  const result = await query<{ id: string }>(
    "INSERT INTO monitor_runs (retailer_id, source_url, run_kind, status) VALUES ($1,$2,$3,'running') RETURNING id",
    [retailerId, sourceUrl, kind],
  );
  return result.rows[0].id;
}

export async function finishMonitorRun(input: { id: string; status: "ok" | "blocked" | "failed" | "partial"; productsSeen: number; message?: string; details?: unknown }) {
  await query(
    "UPDATE monitor_runs SET status=$2, products_seen=$3, finished_at=now(), message=$4, details=$5::jsonb WHERE id=$1",
    [input.id, input.status, input.productsSeen, input.message ?? null, JSON.stringify(input.details ?? {})],
  );
}
