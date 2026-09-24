import type { D1Database } from "./d1.js";
import { LGR_CATALOG_URL, parseLgrCatalog } from "./lgr.js";
import { parseRobots, robotsPath } from "../../../services/backend/src/lib/robots.js";

const SOURCE_ID = "la-grande-recre:tcg-category";
const RETAILER_ID = "la-grande-recre";
const RETAILER_NAME = "La Grande Récré";
const LOCAL_EVIDENCE_METHODS = new Set([
  "official_store_api",
  "official_store_page",
  "official_pickup_result",
]);
const RETAILER_HOSTS: Record<string, string[]> = {
  fnac: ["fnac.com"],
  "king-jouet": ["king-jouet.com"],
  carrefour: ["carrefour.fr"],
  "la-grande-recre": ["lagranderecre.fr"],
};
const MAX_CATALOG_BYTES = 1_500_000;
const MAX_ROBOTS_BYTES = 128 * 1024;
const MAX_FEED_ITEMS = 200;
const MAX_OBSERVATION_AGE_SECONDS = 15 * 60;
const PRODUCT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MAX_LIVE_CATALOG_AGE_SECONDS = 6 * 60 * 60;

type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  CATALOG_URL?: string;
  MIN_CATALOG_INTERVAL_SECONDS?: string;
  ROBOTS_TTL_SECONDS?: string;
};

type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type CronController = { cron: string; scheduledTime: number };
type RetailerId = keyof typeof RETAILER_HOSTS;
type ProductRow = Record<string, unknown>;
type SourceStateRow = {
  robots_checked_at: number | null;
  robots_http_status: number | null;
  robots_text: string | null;
  consecutive_failures: number;
  last_success_at?: number | null;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    if (!cors.allowed) return json({ error: "origin_not_allowed" }, 403, cors.headers);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz" && request.method === "GET") {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ status: "ok", database: "connected", storeInventory: "unknown_without_official_local_evidence" }, 200, cors.headers);
      }
      if (url.pathname === "/api/v1/feed" && request.method === "GET") {
        return json(await readFeed(env), 200, cors.headers);
      }
      if (url.pathname === "/api/v1/alerts") {
        return json({ error: "alerts_not_configured", message: "Server-side alert storage requires abuse protection. Rules remain local to this device." }, 503, cors.headers);
      }
      if (url.pathname === "/api/v1/push/config" || url.pathname === "/api/v1/push/subscribe") {
        return json({ error: "push_not_configured", message: "Push needs VAPID keys and a sender. No push subscription was saved." }, 503, cors.headers);
      }
      return json({ error: "not_found" }, 404, cors.headers);
    } catch (error) {
      console.error("api_request_failed", error instanceof Error ? error.message : "unknown_error");
      return json({ error: "internal_error" }, 500, cors.headers);
    }
  },

  scheduled(_controller: CronController, env: Env, context: WorkerExecutionContext) {
    context.waitUntil(refreshCatalog(env));
  },
};

async function readFeed(env: Env) {
  const now = epochSeconds();
  const source = await env.DB.prepare("SELECT last_success_at FROM source_state WHERE source_id = ?")
    .bind(SOURCE_ID).first<{ last_success_at: number | null }>();
  const checkedAt = toIso(source?.last_success_at);
  if (source?.last_success_at == null || source.last_success_at <= 0
    || source.last_success_at > now + 60
    || now - source.last_success_at > MAX_LIVE_CATALOG_AGE_SECONDS) {
    return { configured: true, connected: true, source: "empty" as const, items: [], checkedAt, snapshotAt: null };
  }
  const rows = await env.DB.prepare(`
    WITH latest AS (
      SELECT observations.*,
        ROW_NUMBER() OVER (PARTITION BY product_id, store_id ORDER BY checked_at DESC, id DESC) AS row_number
      FROM observations
      WHERE checked_at >= ?
    )
    SELECT p.id AS product_id, p.ean, p.title, p.image_url, p.product_url, p.price_cents,
      p.web_availability, p.last_seen_at, r.id AS retailer_id, r.name AS retailer_name,
      o.status, o.checked_at, o.evidence_url, o.evidence_method, o.evidence_excerpt, o.confidence_score,
      s.id AS store_id, s.retailer_id AS store_retailer_id, s.name AS store_name, s.address AS store_address,
      s.latitude AS store_latitude, s.longitude AS store_longitude
    FROM products p
    JOIN retailers r ON r.id = p.retailer_id
    LEFT JOIN latest o ON o.product_id = p.id AND o.row_number = 1
    LEFT JOIN stores s ON s.id = o.store_id
    WHERE p.retailer_id = ? AND p.catalog_active = 1 AND p.last_seen_at >= ?
    ORDER BY p.last_seen_at DESC
    LIMIT ${MAX_FEED_ITEMS}
  `).bind(now - MAX_OBSERVATION_AGE_SECONDS, RETAILER_ID, now - PRODUCT_RETENTION_SECONDS).all<ProductRow>();

  const items = rows.results.map((row) => mapFeedItem(row, now));
  return {
    configured: true,
    connected: true,
    source: "live" as const,
    items,
    checkedAt,
    snapshotAt: null,
  };
}

function mapFeedItem(row: ProductRow, now: number) {
  const observation = verifiedObservation(row, now);
  const checkedAt = observation.checkedAt ?? toIso(asNumber(row.last_seen_at)) ?? new Date().toISOString();
  return {
    id: String(row.product_id),
    retailer: { id: String(row.retailer_id), name: String(row.retailer_name) },
    product: {
      title: String(row.title),
      ean: asNullableString(row.ean),
      imageUrl: asNullableString(row.image_url),
      productUrl: String(row.product_url),
    },
    priceCents: asNullableNumber(row.price_cents),
    webAvailability: normalizeWebAvailability(row.web_availability),
    status: observation.status,
    store: observation.store,
    checkedAt,
    confidence: observation.confidence,
    evidence: observation.evidence,
  };
}

function verifiedObservation(row: ProductRow, now: number) {
  const checkedAtSeconds = asNumber(row.checked_at);
  const status = row.status;
  const retailerId = String(row.retailer_id);
  const storeId = asNullableString(row.store_id);
  const storeName = asNullableString(row.store_name);
  const evidenceUrl = asNullableString(row.evidence_url);
  const method = asNullableString(row.evidence_method);
  const excerpt = asNullableString(row.evidence_excerpt);
  const score = asNullableNumber(row.confidence_score);
  const current = checkedAtSeconds !== null
    && checkedAtSeconds <= now + 60
    && now - checkedAtSeconds <= MAX_OBSERVATION_AGE_SECONDS;
  const officialUrl = isOfficialEvidenceUrl(retailerId, evidenceUrl);

  if ((status !== "in_stock" && status !== "out_of_stock")
    || !current || !storeId || !storeName
    || String(row.store_retailer_id) !== retailerId
    || storeName.length > 120
    || !method || !LOCAL_EVIDENCE_METHODS.has(method)
    || !officialUrl || !excerpt?.trim() || excerpt.length > 500
    || !evidenceUrl || evidenceUrl.length > 2048
    || score === null || score <= 0 || score > 1) {
    return { status: "unknown" as const, store: null, checkedAt: toIso(checkedAtSeconds), confidence: null, evidence: null };
  }
  const lat = asNullableNumber(row.store_latitude);
  const lon = asNullableNumber(row.store_longitude);
  const coordinatesValid = lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  return {
    status,
    store: {
      id: storeId,
      name: storeName,
      address: asNullableString(row.store_address),
      latitude: coordinatesValid ? lat : null,
      longitude: coordinatesValid ? lon : null,
    },
    checkedAt: toIso(checkedAtSeconds),
    confidence: score,
    evidence: { method, url: evidenceUrl, summary: excerpt },
  };
}

function isOfficialEvidenceUrl(retailerId: string, value: string | null): boolean {
  const hosts = RETAILER_HOSTS[retailerId as RetailerId];
  if (!hosts || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function normalizeWebAvailability(value: unknown): "available" | "unavailable" | "unknown" {
  return value === "available" || value === "unavailable" ? value : "unknown";
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "https://mwrtyy.github.io,http://localhost:3000")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = !origin || allowedOrigins.includes(origin);
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
  return { allowed, headers };
}

function json(value: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toIso(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

class SourceFetchError extends Error {
  constructor(message: string, readonly httpStatus: number | null = null, readonly retrySeconds?: number) {
    super(message);
  }
}

async function refreshCatalog(env: Env): Promise<void> {
  const now = epochSeconds();
  const acquired = await env.DB.prepare(`
    INSERT INTO source_state (source_id, lease_until, next_check_at, last_attempt_at)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(source_id) DO UPDATE SET lease_until = excluded.lease_until, last_attempt_at = excluded.last_attempt_at
    WHERE source_state.lease_until <= ? AND source_state.next_check_at <= ?
    RETURNING source_id
  `).bind(SOURCE_ID, now + 90, now, now, now).first<{ source_id: string }>();
  if (!acquired) return;

  try {
    const catalogUrl = validateCatalogUrl(env.CATALOG_URL);
    const robotsText = await getRobotsText(env, catalogUrl, now);
    const policy = parseRobots(robotsText, robotsPath(catalogUrl));
    if (!policy.allowed) {
      throw new SourceFetchError(`robots_${policy.reason}`, null, Math.max(6 * 60 * 60, policy.crawlDelayMs / 1000));
    }

    const response = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: {
        "User-Agent": "PokemonRestockFRBot/0.1 (+https://github.com/Mwrtyy/poke-fr-pull)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new SourceFetchError(`catalog_http_${response.status}`, response.status);
    const html = await readTextLimited(response, MAX_CATALOG_BYTES);
    const products = parseLgrCatalog(html, catalogUrl.toString());
    if (!products.length) {
      throw new SourceFetchError(`catalog_parse_empty_or_over_limit:${html.length}`);
    }

    const statements = [
      env.DB.prepare("UPDATE products SET catalog_active = 0 WHERE retailer_id = ?").bind(RETAILER_ID),
      ...products.map((product) => {
        const id = `lgr:${hashText(product.productUrl)}`;
        return env.DB.prepare(`
          INSERT INTO products
            (id, retailer_id, external_ref, ean, title, image_url, product_url, price_cents, web_availability, discovered_at, last_seen_at, catalog_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(retailer_id, product_url) DO UPDATE SET
            external_ref = excluded.external_ref,
            ean = excluded.ean,
            title = excluded.title,
            image_url = excluded.image_url,
            price_cents = excluded.price_cents,
            web_availability = excluded.web_availability,
            last_seen_at = excluded.last_seen_at,
            catalog_active = 1
        `).bind(
          id, RETAILER_ID, product.externalRef, product.ean, product.title,
          product.imageUrl, product.productUrl, product.priceCents,
          product.webAvailability, now, now,
        );
      }),
    ];
    await env.DB.batch(statements);

    const minInterval = positiveInteger(env.MIN_CATALOG_INTERVAL_SECONDS, 60);
    const retryDelay = Math.max(minInterval, Math.ceil(policy.crawlDelayMs / 1000));
    await env.DB.prepare(`
      UPDATE source_state SET next_check_at = ?, lease_until = 0,
        last_success_at = ?, last_http_status = 200, last_error = NULL,
        product_count = ?, consecutive_failures = 0
      WHERE source_id = ?
    `).bind(now + retryDelay, now, products.length, SOURCE_ID).run();
  } catch (error) {
    const failure = error instanceof SourceFetchError ? error : new SourceFetchError(errorMessage(error));
    const state = await env.DB.prepare("SELECT consecutive_failures FROM source_state WHERE source_id = ?")
      .bind(SOURCE_ID).first<Pick<SourceStateRow, "consecutive_failures">>();
    const failures = Math.min((asNumber(state?.consecutive_failures) ?? 0) + 1, 10);
    const exponentialDelay = Math.min(6 * 60 * 60, 60 * 2 ** failures);
    const retryDelay = Math.max(failure.retrySeconds ?? 0, exponentialDelay, positiveInteger(env.MIN_CATALOG_INTERVAL_SECONDS, 60));
    await env.DB.prepare(`
      UPDATE source_state SET next_check_at = ?, lease_until = 0,
        last_http_status = ?, last_error = ?, consecutive_failures = ?
      WHERE source_id = ?
    `).bind(now + retryDelay, failure.httpStatus, failure.message.slice(0, 240), failures, SOURCE_ID).run();
    console.warn("lgr_refresh_skipped", failure.message);
  }
}

export { verifiedObservation };

function validateCatalogUrl(value: string | undefined): URL {
  const url = new URL(value || LGR_CATALOG_URL);
  if (url.toString() !== LGR_CATALOG_URL) throw new SourceFetchError("catalog_url_not_allowlisted");
  return url;
}

async function getRobotsText(env: Env, catalogUrl: URL, now: number): Promise<string> {
  const cached = await env.DB.prepare(`
    SELECT robots_checked_at, robots_http_status, robots_text
    FROM source_state WHERE source_id = ?
  `).bind(SOURCE_ID).first<SourceStateRow>();
  const ttl = positiveInteger(env.ROBOTS_TTL_SECONDS, 6 * 60 * 60);
  if (cached?.robots_checked_at && now - cached.robots_checked_at < ttl) {
    if (cached.robots_http_status !== 200 || typeof cached.robots_text !== "string") {
      throw new SourceFetchError(`robots_cached_http_${cached.robots_http_status ?? "unavailable"}`, cached.robots_http_status);
    }
    return cached.robots_text;
  }

  const robotsUrl = new URL("/robots.txt", catalogUrl.origin);
  let response: Response;
  try {
    response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: {
        "User-Agent": "PokemonRestockFRBot/0.1 (+https://github.com/Mwrtyy/poke-fr-pull)",
        Accept: "text/plain",
      },
    });
  } catch {
    throw new SourceFetchError("robots_unavailable");
  }
  if (!response.ok) {
    await saveRobots(env, now, response.status, null);
    throw new SourceFetchError(`robots_http_${response.status}`, response.status);
  }
  const text = await readTextLimited(response, MAX_ROBOTS_BYTES);
  await saveRobots(env, now, response.status, text);
  return text;
}

async function saveRobots(env: Env, checkedAt: number, status: number, text: string | null) {
  await env.DB.prepare(`
    UPDATE source_state SET robots_checked_at = ?, robots_http_status = ?, robots_text = ? WHERE source_id = ?
  `).bind(checkedAt, status, text, SOURCE_ID).run();
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new SourceFetchError("source_response_empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new SourceFetchError("source_response_over_limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hashText(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x01000193;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "refresh_failed";
}
