import { describe, expect, it, vi } from "vitest";
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

describe("robots fetch diagnostics", () => {
  it("logs and persists a redacted fetch failure while keeping the refresh closed", async () => {
    const updates: Array<{ query: string; values: unknown[] }> = [];
    const db: D1Database = {
      prepare(query) {
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind(...bound) { values = bound; return statement; },
          async first<T>() {
            if (query.includes("RETURNING source_id")) return { source_id: "la-grande-recre:tcg-category" } as T;
            if (query.includes("SELECT consecutive_failures")) return { consecutive_failures: 2 } as T;
            return null;
          },
          async all<T>() { return { results: [] as T[], success: true, meta: { changes: 0 } }; },
          async run<T>() {
            if (query.includes("last_error = ?")) updates.push({ query, values });
            return { results: [] as T[], success: true, meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch<T>() { return [] as D1Result<T>[]; },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("redirect mode rejected https://private.example/path?token=secret-value");
    });
    let refresh: Promise<void> | undefined;
    try {
      worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() } as never, { DB: db } as never, {
        waitUntil(promise: Promise<unknown>) { refresh = promise.then(() => undefined); },
      } as never);
      if (!refresh) throw new Error("scheduled refresh was not queued");
      await refresh;

      const diagnostic = log.mock.calls.find(([event]) => event === "lgr_robots_fetch_failed")?.[1];
      expect(diagnostic).toMatchObject({ code: "redirect", name: "TypeError" });
      expect(JSON.stringify(diagnostic)).not.toContain("private.example");
      expect(JSON.stringify(diagnostic)).not.toContain("secret-value");
      const failure = updates.find(({ query }) => query.includes("last_error = ?"))?.values[2];
      expect(failure).toBe("robots_unavailable:redirect:TypeError:redirect mode rejected [url]");
      expect(String(failure)).not.toContain("secret-value");
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("catalog redirects", () => {
  it("rejects a robots redirect without requesting its Location", async () => {
    const db = cronDatabase();
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return new Response(null, { status: 302, headers: { Location: "https://outside.example/robots.txt" } });
    });

    try {
      await runScheduled(db.database);
      expect(calls).toEqual([{ url: "https://www.lagranderecre.fr/robots.txt", redirect: "manual" }]);
      expect(db.updates.find(({ query }) => query.includes("last_error = ?"))?.values[2]).toBe("robots_redirect_302");
      expect(db.batchCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a catalog redirect without requesting its Location", async () => {
    const db = cronDatabase();
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, redirect: init?.redirect });
      return url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nAllow: /\n")
        : new Response(null, { status: 307, headers: { Location: "https://outside.example/catalog.html" } });
    });

    try {
      await runScheduled(db.database);
      expect(calls).toEqual([
        { url: "https://www.lagranderecre.fr/robots.txt", redirect: "manual" },
        { url: "https://www.lagranderecre.fr/cartes-a-collectionner-pokemon.html", redirect: "manual" },
      ]);
      expect(db.updates.find(({ query }) => query.includes("last_error = ?"))?.values[2]).toBe("catalog_redirect_307");
      expect(db.batchCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
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

function cronDatabase() {
  const updates: Array<{ query: string; values: unknown[] }> = [];
  let batchCount = 0;
  const database: D1Database = {
    prepare(query) {
      let values: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...bound) { values = bound; return statement; },
        async first<T>() {
          if (query.includes("RETURNING source_id")) return { source_id: "la-grande-recre:tcg-category" } as T;
          if (query.includes("SELECT consecutive_failures")) return { consecutive_failures: 0 } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[], success: true, meta: { changes: 0 } }; },
        async run<T>() {
          updates.push({ query, values });
          return { results: [] as T[], success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch<T>() { batchCount++; return [] as D1Result<T>[]; },
  };
  return { database, updates, batchCount: () => batchCount };
}

async function runScheduled(database: D1Database): Promise<void> {
  let refresh: Promise<void> | undefined;
  worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() } as never, { DB: database } as never, {
    waitUntil(promise: Promise<unknown>) { refresh = promise.then(() => undefined); },
  } as never);
  if (!refresh) throw new Error("scheduled refresh was not queued");
  await refresh;
}
