import webpush from "web-push";
import { config } from "./config.js";
import { query } from "./db.js";

type AlertMatch = {
  rule_id: string;
  installation_id: string;
  query: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  retailer_name: string;
  store_name: string;
  address: string | null;
  price_cents: number | null;
  product_url: string;
};

export async function dispatchConfirmedStockAlert(observationId: string) {
  if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) return;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  const matches = await query<AlertMatch>(
    `SELECT ar.id AS rule_id, ar.installation_id, ar.query,
            ps.endpoint, ps.p256dh, ps.auth,
            p.title, r.name AS retailer_name, s.name AS store_name, s.address,
            o.price_cents, p.product_url
       FROM observations o
       JOIN products p ON p.id = o.product_id
       JOIN retailers r ON r.id = p.retailer_id
       JOIN stores s ON s.id = o.store_id
       JOIN alert_rules ar ON ar.enabled = true
       JOIN push_subscriptions ps ON ps.installation_id = ar.installation_id
      WHERE o.id = $1
        AND o.status = 'in_stock'
        AND r.id = ANY(ar.retailer_ids)
        AND position(lower(ar.query) in lower(p.title || ' ' || coalesce(p.ean, ''))) > 0
        AND (ar.max_price_cents IS NULL OR (o.price_cents IS NOT NULL AND o.price_cents <= ar.max_price_cents))
        AND s.location IS NOT NULL
        AND ar.origin_latitude IS NOT NULL
        AND extensions.ST_DWithin(
          s.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(ar.origin_longitude, ar.origin_latitude), 4326)::extensions.geography,
          ar.max_distance_km * 1000
        )
        AND NOT EXISTS (SELECT 1 FROM sent_alerts sa WHERE sa.rule_id = ar.id AND sa.observation_id = o.id)` ,
    [observationId],
  );

  for (const match of matches.rows) {
    const claim = await query<{ id: string }>(
      "INSERT INTO sent_alerts (rule_id, observation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [match.rule_id, observationId],
    );
    if (!claim.rowCount) continue;
    const destination = new URL(match.product_url);
    const body = `${match.store_name}${match.address ? ` · ${match.address}` : ""} · ${match.retailer_name}${match.price_cents === null ? "" : ` · ${(match.price_cents / 100).toFixed(2)} €`}`;
    try {
      await webpush.sendNotification(
        { endpoint: match.endpoint, keys: { p256dh: match.p256dh, auth: match.auth } },
        JSON.stringify({ title: "Stock magasin confirmé", body, url: destination.toString(), tag: `stock-${observationId}` }),
        { TTL: 300 },
      );
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await query("DELETE FROM push_subscriptions WHERE endpoint=$1", [match.endpoint]);
      }
    }
  }
}
