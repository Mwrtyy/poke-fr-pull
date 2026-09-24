import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./lib/config.js";
import { pool, query } from "./lib/db.js";
import { redis } from "./lib/redis.js";

const retailerId = z.enum(["fnac", "king-jouet", "carrefour", "la-grande-recre"]);
const installationIdSchema = z.string().uuid();
const alertInput = z.object({
  installationId: installationIdSchema,
  query: z.string().trim().min(1).max(160),
  maxPriceCents: z.number().int().nonnegative().max(500_000).nullable(),
  maxDistanceKm: z.number().positive().max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  retailers: z.array(retailerId).min(1).max(4),
});

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 128 * 1024 });
await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "OPTIONS"] });
await app.register(rateLimit, { max: 90, timeWindow: "1 minute" });

app.setErrorHandler((error, _request, reply) => {
  app.log.error({ err: error }, "API request failed");
  void reply.code(500).send({ error: "internal_error" });
});

app.get("/healthz", async (_request, reply) => {
  try {
    await query("SELECT 1");
    const redisStatus = await redis.ping();
    return { status: redisStatus === "PONG" ? "ok" : "degraded", database: "ok", redis: redisStatus.toLowerCase() };
  } catch {
    return reply.code(503).send({ status: "degraded" });
  }
});

app.get("/api/v1/feed", async () => {
  type FeedRow = {
    observation_id: string;
    retailer_id: string;
    retailer_name: string;
    product_title: string;
    ean: string | null;
    image_url: string | null;
    product_url: string;
    price_cents: number | null;
    web_availability: "available" | "unavailable" | "unknown";
    status: "in_stock" | "out_of_stock" | "unknown";
    store_id: string | null;
    store_name: string | null;
    store_address: string | null;
    latitude: number | null;
    longitude: number | null;
    checked_at: Date;
    confidence_score: string | null;
    evidence_method: string | null;
    evidence_url: string | null;
    evidence_excerpt: string | null;
  };
  const result = await query<FeedRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (o.product_id, o.store_id)
         o.id AS observation_id, r.id AS retailer_id, r.name AS retailer_name,
         p.title AS product_title, p.ean, p.image_url, p.product_url,
         o.price_cents, o.web_availability,
         CASE WHEN o.status <> 'unknown' AND o.checked_at < now() - interval '15 minutes' THEN 'unknown' ELSE o.status END AS status,
         s.id AS store_id, s.name AS store_name, s.address AS store_address, s.latitude, s.longitude,
         o.checked_at,
         CASE WHEN o.checked_at < now() - interval '15 minutes' THEN NULL ELSE o.confidence_score END AS confidence_score,
         o.evidence_method, o.evidence_url, o.evidence_excerpt
       FROM observations o
       JOIN products p ON p.id = o.product_id
       JOIN retailers r ON r.id = p.retailer_id
       LEFT JOIN stores s ON s.id = o.store_id
       WHERE o.checked_at >= now() - interval '72 hours'
       ORDER BY o.product_id, o.store_id, o.checked_at DESC
     )
     SELECT * FROM latest
     ORDER BY (status = 'in_stock') DESC, checked_at DESC
     LIMIT 100`,
  );
  const items = result.rows.map((row) => ({
    id: row.observation_id,
    retailer: { id: row.retailer_id, name: row.retailer_name },
    product: { title: row.product_title, ean: row.ean, imageUrl: row.image_url, productUrl: row.product_url },
    priceCents: row.price_cents,
    webAvailability: row.web_availability,
    status: row.status,
    store: row.store_id ? {
      id: row.store_id,
      name: row.store_name,
      address: row.store_address,
      latitude: row.latitude,
      longitude: row.longitude,
    } : null,
    checkedAt: row.checked_at.toISOString(),
    confidence: row.confidence_score === null ? null : Number(row.confidence_score),
    evidence: row.evidence_method && row.evidence_url ? {
      method: row.evidence_method,
      url: row.evidence_url,
      summary: row.evidence_excerpt ?? "Preuve source officielle",
    } : null,
  }));
  const checkedAt = result.rows[0]?.checked_at?.toISOString() ?? null;
  return { configured: true, connected: true, source: "live", items, checkedAt, snapshotAt: null };
});

app.get<{ Querystring: { installationId?: string } }>("/api/v1/alerts", async (request, reply) => {
  const parsed = installationIdSchema.safeParse(request.query.installationId);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_installation_id" });
  const result = await query<{
    id: string; query: string; max_price_cents: number | null; max_distance_km: string;
    retailer_ids: string[]; origin_latitude: number; origin_longitude: number;
  }>(
    `SELECT id, query, max_price_cents, max_distance_km, retailer_ids, origin_latitude, origin_longitude
       FROM alert_rules WHERE installation_id=$1 AND enabled=true ORDER BY created_at DESC LIMIT 20`,
    [parsed.data],
  );
  return { rules: result.rows.map((rule) => ({
    id: rule.id,
    query: rule.query,
    maxPriceCents: rule.max_price_cents,
    maxDistanceKm: Number(rule.max_distance_km),
    retailers: rule.retailer_ids,
    latitude: rule.origin_latitude,
    longitude: rule.origin_longitude,
  })) };
});

app.post("/api/v1/alerts", async (request, reply) => {
  const parsed = alertInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_alert_rule", details: parsed.error.issues.map((issue) => issue.path.join(".")) });
  const input = parsed.data;
  const result = await query<{ id: string }>(
    `INSERT INTO alert_rules (installation_id, query, max_price_cents, max_distance_km, origin_latitude, origin_longitude, retailer_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [input.installationId, input.query, input.maxPriceCents, input.maxDistanceKm, input.latitude, input.longitude, input.retailers],
  );
  return reply.code(201).send({ id: result.rows[0].id });
});

app.get("/api/v1/push/config", async (_request, reply) => {
  if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) {
    return reply.code(503).send({ error: "push_not_configured" });
  }
  return { publicKey: config.vapidPublicKey };
});

const pushInput = z.object({
  installationId: installationIdSchema,
  subscription: z.object({
    endpoint: z.string().url().startsWith("https://").max(2048),
    keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
  }),
});

app.post("/api/v1/push/subscribe", async (request, reply) => {
  const parsed = pushInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_push_subscription" });
  if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) return reply.code(503).send({ error: "push_not_configured" });
  const endpoint = new URL(parsed.data.subscription.endpoint);
  const trustedHosts = ["fcm.googleapis.com", "notify.windows.com", "push.services.mozilla.com", "web.push.apple.com"];
  if (!trustedHosts.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`))) {
    return reply.code(400).send({ error: "unsupported_push_endpoint" });
  }
  await query(
    `INSERT INTO push_subscriptions (installation_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET installation_id=EXCLUDED.installation_id, p256dh=EXCLUDED.p256dh,
       auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, updated_at=now()`,
    [parsed.data.installationId, endpoint.toString(), parsed.data.subscription.keys.p256dh, parsed.data.subscription.keys.auth, request.headers["user-agent"] ?? null],
  );
  return reply.code(201).send({ subscribed: true });
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await pool.end();
  await redis.quit();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    await redis.quit();
    process.exit(0);
  });
}
