import { parseRobots, robotsPath } from "./robots.js";
import { waitForHostSlot } from "./redis.js";
import type { RetailerAdapter } from "./contracts.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;
const USER_AGENT = "PokemonRestockFRBot/0.1 (+https://github.com/Mwrtyy/poke-fr-pull)";
const robotsCache = new Map<string, { text: string; fetchedAt: number; status: number }>();

export type PublicPage = {
  url: string;
  status: number;
  contentType: string;
  text: string;
  robotsReason: string;
};

export class SourceBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceBlockedError";
  }
}

export async function fetchPublicPage(input: { url: string; adapter: RetailerAdapter; redisRateLimit: boolean; sitemapsAllowed?: boolean }): Promise<PublicPage> {
  const initialUrl = new URL(input.url);
  if (initialUrl.protocol !== "https:" || !input.adapter.hosts.includes(initialUrl.hostname.toLowerCase())) {
    throw new SourceBlockedError("URL host or scheme not allowlisted");
  }

  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    if (!input.adapter.hosts.includes(currentUrl.hostname.toLowerCase())) throw new SourceBlockedError("cross-host redirect refused");
    const robots = await getRobots(currentUrl);
    if (robots.status < 200 || robots.status >= 300) throw new SourceBlockedError(`robots_http_${robots.status}`);
    const policy = parseRobots(robots.text, robotsPath(currentUrl));
    const declaredSitemap = input.sitemapsAllowed && policy.sitemaps.some((sitemap) => new URL(sitemap).toString() === currentUrl.toString());
    if (!policy.allowed && !declaredSitemap) {
      throw new SourceBlockedError(`robots_${policy.reason}`);
    }
    if (input.redisRateLimit) await waitForHostSlot(currentUrl.hostname, policy.crawlDelayMs);
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/ld+json,application/xml,text/xml;q=0.9,*/*;q=0.5" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new SourceBlockedError("redirect limit reached");
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    const text = await readLimitedText(response);
    return {
      url: currentUrl.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text,
      robotsReason: policy.reason,
    };
  }
  throw new SourceBlockedError("redirect limit reached");
}

export async function listAllowedSitemaps(url: URL) {
  const robots = await getRobots(url);
  if (robots.status < 200 || robots.status >= 300) return [];
  const robotsUrl = new URL("/robots.txt", url.origin);
  return parseRobots(robots.text, robotsPath(url)).sitemaps.filter((value) => {
    try {
      return new URL(value).hostname.toLowerCase() === url.hostname.toLowerCase();
    } catch {
      return false;
    }
  });
}

async function getRobots(url: URL) {
  const cached = robotsCache.get(url.origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached;
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: { "user-agent": USER_AGENT, accept: "text/plain" },
    });
    const text = response.ok ? await readLimitedText(response, 512 * 1024) : "";
    const result = { text, fetchedAt: Date.now(), status: response.status };
    robotsCache.set(url.origin, result);
    return result;
  } catch {
    const result = { text: "", fetchedAt: Date.now(), status: 0 };
    robotsCache.set(url.origin, result);
    return result;
  }
}

function readLimitedText(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return Promise.resolve("");
  return (async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("source response exceeds 2 MB limit");
      }
      chunks.push(value);
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
  })();
}
