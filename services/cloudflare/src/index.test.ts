import { describe, expect, it } from "vitest";
import worker, { verifiedObservation } from "./index.js";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1.js";

const now = 1_800_000_000;

function observation(overrides: Record<string, unknown> = {}) {
  return {
    retailer_id: "la-grande-recre",
    status: "in_stock",
    checked_at: now,
    evidence_url: "https://www.lagranderecre.fr/product.html",
    evidence_method: "official_pickup_result",
    evidence_excerpt: "Disponible dans ce magasin.",
    confidence_score: 0.9,
    store_id: "lgr-paris-01",
    store_retailer_id: "la-grande-recre",
    store_name: "La Grande Récré Paris",
    store_address: "Paris",
    store_latitude: 48.8566,
    store_longitude: 2.3522,
    ...overrides,
  };
}

describe("store evidence gate", () => {
  it("accepts fresh official evidence for an exact store", () => {
    expect(verifiedObservation(observation(), now)).toMatchObject({
      status: "in_stock",
      store: { id: "lgr-paris-01", latitude: 48.8566, longitude: 2.3522 },
      confidence: 0.9,
      evidence: { method: "official_pickup_result" },
    });
  });

  it.each([
    ["missing store", { store_id: null, store_name: null, store_retailer_id: null }],
    ["mismatched retailer", { store_retailer_id: "fnac" }],
    ["off-domain URL", { evidence_url: "https://attacker.example/stock" }],
    ["web-only method", { evidence_method: "catalog_feed" }],
    ["stale evidence", { checked_at: now - 901 }],
    ["zero confidence", { confidence_score: 0 }],
  ])("keeps %s observation unknown", (_label, overrides) => {
    expect(verifiedObservation(observation(overrides), now)).toMatchObject({
      status: "unknown",
      store: null,
      confidence: null,
      evidence: null,
    });
  });
});

describe("public API readiness", () => {
  it("does not report a live feed before the first successful catalog refresh", async () => {
    const db = stubDatabase(null);
    const response = await worker.fetch(new Request("https://api.example/api/v1/feed", {
      headers: { Origin: "https://mwrtyy.github.io" },
    }), { DB: db });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: true, source: "empty", items: [], checkedAt: null });
  });

  it("keeps server alert endpoints disabled until abuse protection exists", async () => {
    const response = await worker.fetch(new Request("https://api.example/api/v1/alerts", {
      method: "POST",
      headers: { Origin: "https://mwrtyy.github.io", "Content-Type": "application/json" },
      body: "{}",
    }), { DB: stubDatabase(null) });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "alerts_not_configured" });
  });
});

function stubDatabase(first: unknown): D1Database {
  const statement: D1PreparedStatement = {
    bind() { return statement; },
    async first<T>() { return first as T | null; },
    async all<T>() { return { results: [] as T[], success: true, meta: { changes: 0 } }; },
    async run<T>() { return { results: [] as T[], success: true, meta: { changes: 0 } }; },
  };
  return { prepare() { return statement; }, async batch<T>() { return [] as D1Result<T>[]; } };
}
