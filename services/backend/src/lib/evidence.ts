import type { EvidenceMethod, StoreObservation, StoreStatus, WebAvailability } from "./contracts.js";

const LOCAL_EVIDENCE = new Set<EvidenceMethod>([
  "official_store_api",
  "official_store_page",
  "official_pickup_result",
]);

export function normalizeWebAvailability(value: unknown): WebAvailability {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLocaleLowerCase("en-US");
  if (normalized.includes("instock") || normalized.includes("in_stock") || normalized === "available") return "available";
  if (normalized.includes("outofstock") || normalized.includes("out_of_stock") || normalized === "unavailable") return "unavailable";
  return "unknown";
}

export function confidenceForEvidence(
  method: EvidenceMethod,
  checkedAt: Date,
  now = new Date(),
): number | null {
  if (!LOCAL_EVIDENCE.has(method)) return null;
  const ageMinutes = Math.max(0, (now.getTime() - checkedAt.getTime()) / 60_000);
  if (ageMinutes > 30) return null;
  const startingConfidence: Record<"official_store_api" | "official_store_page" | "official_pickup_result", number> = {
    official_store_api: 0.99,
    official_store_page: 0.94,
    official_pickup_result: 0.9,
  };
  const base = startingConfidence[method as keyof typeof startingConfidence];
  return Math.round(Math.max(0, base - ageMinutes * 0.012) * 100) / 100;
}

export function makeUnknownObservation<T extends StoreObservation["product"]>(product: T, checkedAt = new Date()): StoreObservation {
  return {
    product,
    status: "unknown",
    store: null,
    checkedAt: checkedAt.toISOString(),
    confidence: null,
    evidence: null,
  };
}

export function validateStoreSignal(input: {
  status: StoreStatus;
  storeRef: string | null;
  evidence: { method: EvidenceMethod; url: string; excerpt: string } | null;
  checkedAt: Date;
  now?: Date;
}): { valid: true; confidence: number } | { valid: false; reason: string } {
  if (input.status === "unknown") return { valid: false, reason: "unknown_is_not_a_store_signal" };
  if (!input.storeRef?.trim()) return { valid: false, reason: "exact_store_required" };
  if (!input.evidence || !LOCAL_EVIDENCE.has(input.evidence.method)) return { valid: false, reason: "official_local_evidence_required" };
  if (!input.evidence.url.startsWith("https://")) return { valid: false, reason: "https_evidence_url_required" };
  if (!input.evidence.excerpt.trim()) return { valid: false, reason: "evidence_excerpt_required" };
  const confidence = confidenceForEvidence(input.evidence.method, input.checkedAt, input.now);
  if (confidence === null) return { valid: false, reason: "evidence_stale_or_unscored" };
  return { valid: true, confidence };
}
