import type { AlertRule, FeedResponse } from "./types";
import catalog from "./catalog.json";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const snapshotItems = catalog.items as FeedResponse["items"];
const snapshotAt = catalog.builtAt;

function fallbackResponse(configured: boolean): FeedResponse {
  return {
    configured,
    connected: false,
    source: snapshotItems.length ? "snapshot" : "empty",
    items: snapshotItems,
    checkedAt: null,
    snapshotAt,
  };
}

export function isApiConfigured() {
  return apiBase.length > 0;
}

export function initialFeedResponse() {
  return fallbackResponse(apiBase.length > 0);
}

export async function loadFeed(signal?: AbortSignal): Promise<FeedResponse> {
  if (!apiBase) return fallbackResponse(false);
  try {
    const response = await fetch(`${apiBase}/api/v1/feed?region=ile-de-france`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = (await response.json()) as FeedResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return { ...fallbackResponse(true), connected: true };
    return { configured: true, connected: true, source: "live", items, checkedAt: data.checkedAt ?? null, snapshotAt };
  } catch {
    return fallbackResponse(true);
  }
}

export async function loadRules(installationId: string): Promise<AlertRule[]> {
  if (!apiBase) return [];
  try {
    const response = await fetch(`${apiBase}/api/v1/alerts?installationId=${encodeURIComponent(installationId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { rules?: AlertRule[] };
    return data.rules ?? [];
  } catch {
    return [];
  }
}

export async function saveRule(installationId: string, rule: Omit<AlertRule, "id">): Promise<boolean> {
  if (!apiBase) return false;
  try {
    const response = await fetch(`${apiBase}/api/v1/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId, ...rule }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function apiBaseUrl() {
  return apiBase;
}
