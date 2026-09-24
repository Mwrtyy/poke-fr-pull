import { describe, expect, it } from "vitest";
import { confidenceForEvidence, makeUnknownObservation, normalizeWebAvailability, validateStoreSignal } from "../src/lib/evidence.js";
import type { RetailerProduct } from "../src/lib/contracts.js";

const product: RetailerProduct = {
  retailerId: "la-grande-recre",
  retailerSku: "fixture-sku",
  ean: null,
  title: "Unit test product fixture",
  imageUrl: null,
  productUrl: "https://www.lagranderecre.fr/fixture.html",
  priceCents: 5999,
  webAvailability: "available",
  discoveredAt: "2026-09-24T10:00:00.000Z",
  sourceUrl: "https://www.lagranderecre.fr/catalogue.html",
};

describe("stock evidence rules", () => {
  it("keeps web availability separate from local stock", () => {
    expect(normalizeWebAvailability("https://schema.org/InStock")).toBe("available");
    expect(normalizeWebAvailability("https://schema.org/OutOfStock")).toBe("unavailable");
    const observation = makeUnknownObservation(product);
    expect(observation.status).toBe("unknown");
    expect(observation.store).toBeNull();
    expect(observation.confidence).toBeNull();
  });

  it("requires a recent exact-store proof before returning confidence", () => {
    const now = new Date("2026-09-24T10:10:00.000Z");
    expect(confidenceForEvidence("product_json_ld", new Date("2026-09-24T10:00:00.000Z"), now)).toBeNull();
    expect(confidenceForEvidence("official_store_api", new Date("2026-09-24T10:00:00.000Z"), now)).toBe(0.87);
    expect(confidenceForEvidence("official_store_api", new Date("2026-09-24T09:00:00.000Z"), now)).toBeNull();
    expect(validateStoreSignal({
      status: "in_stock",
      storeRef: null,
      evidence: { method: "official_store_api", url: "https://shop.example/store/1", excerpt: "1 available" },
      checkedAt: new Date("2026-09-24T10:08:00.000Z"),
      now,
    })).toMatchObject({ valid: false, reason: "exact_store_required" });
    expect(validateStoreSignal({
      status: "in_stock",
      storeRef: "store-1",
      evidence: { method: "official_pickup_result", url: "https://shop.example/store/1", excerpt: "Retrait disponible" },
      checkedAt: new Date("2026-09-24T10:08:00.000Z"),
      now,
    })).toMatchObject({ valid: true, confidence: 0.88 });
  });
});
