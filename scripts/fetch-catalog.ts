import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLgrListing } from "../services/backend/src/lib/product-parser.js";
import { parseRobots, robotsPath } from "../services/backend/src/lib/robots.js";

const sourceUrl = "https://www.lagranderecre.fr/cartes-a-collectionner-pokemon.html";
const robotsUrl = new URL("/robots.txt", sourceUrl);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(repoRoot, "apps/web/lib/catalog.json");
const publicFallback = process.env.CATALOG_FALLBACK_URL ?? "";
const userAgent = "PokemonRestockFRBot/0.1 (+https://github.com/Mwrtyy/poke-fr-pull)";

type Snapshot = { builtAt: string | null; source: string; items: unknown[] };

async function main() {
  let previous = await readCurrentSnapshot();
  if (publicFallback) previous = await preferPublishedSnapshot(publicFallback, previous);

  try {
    const robots = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: { "user-agent": userAgent, accept: "text/plain" },
    });
    if (!robots.ok) throw new Error(`robots_http_${robots.status}`);
    const robotsText = await readLimited(robots, 512 * 1024);
    const policy = parseRobots(robotsText, robotsPath(new URL(sourceUrl)));
    if (!policy.allowed) throw new Error(`robots_${policy.reason}`);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(10_000, policy.crawlDelayMs)));
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);
    const html = await readLimited(response, 2 * 1024 * 1024);
    const products = parseLgrListing(html, sourceUrl);
    if (!products.length) {
      const assignmentCount = (html.match(/window\.__change\s*(?:\[\s*['"]24['"]\s*\])?\s*=/g) ?? []).length;
      const payloadCount = (html.match(/productsData/g) ?? []).length;
      throw new Error(`catalog_parser_returned_zero_products:bytes=${html.length},assignments=${assignmentCount},payloads=${payloadCount}`);
    }

    const builtAt = new Date().toISOString();
    const snapshot: Snapshot = {
      builtAt,
      source: sourceUrl,
      items: products.map((product) => ({
        id: `snapshot:${product.retailerSku ?? product.ean ?? product.productUrl}`,
        retailer: { id: "la-grande-recre", name: "La Grande Récré" },
        product: { title: product.title, ean: product.ean, imageUrl: product.imageUrl, productUrl: product.productUrl },
        priceCents: product.priceCents,
        webAvailability: product.webAvailability,
        status: "unknown",
        store: null,
        checkedAt: builtAt,
        confidence: null,
        evidence: null,
        snapshot: true,
      })),
    };
    await persist(snapshot);
    console.log(`Public catalog snapshot updated: ${products.length} products; store status remains unknown.`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "catalog_fetch_failed";
    console.warn(`Catalog refresh skipped (${reason}); keeping previous snapshot with ${previous.items.length} products.`);
    await persist(previous);
  }
}

async function readCurrentSnapshot(): Promise<Snapshot> {
  try {
    const raw = await readFile(target, "utf8");
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    return {
      builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : null,
      source: typeof parsed.source === "string" ? parsed.source : sourceUrl,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { builtAt: null, source: sourceUrl, items: [] };
  }
}

async function preferPublishedSnapshot(url: string, current: Snapshot): Promise<Snapshot> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
    if (!response.ok) return current;
    const remote = JSON.parse(await readLimited(response, 2 * 1024 * 1024)) as Partial<Snapshot>;
    if (!Array.isArray(remote.items) || remote.items.length === 0) return current;
    return {
      builtAt: typeof remote.builtAt === "string" ? remote.builtAt : null,
      source: typeof remote.source === "string" ? remote.source : sourceUrl,
      items: remote.items,
    };
  } catch {
    return current;
  }
}

async function persist(snapshot: Snapshot) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function readLimited(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("source_response_over_limit");
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
}

await main();
