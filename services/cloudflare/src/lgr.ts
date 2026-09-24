export const LGR_CATALOG_URL = "https://www.lagranderecre.fr/cartes-a-collectionner-pokemon.html";

const MAX_EMBEDDED_CHARS = 300_000;
const POKEMON_TCG_TITLE = /(booster|pok[eé]box|cartes?|coffret|pack|initiation|acad[eé]mie|deck|portfolio|etb|display)/iu;

export type DiscoveredProduct = {
  externalRef: string;
  ean: string | null;
  title: string;
  imageUrl: string | null;
  productUrl: string;
  priceCents: number | null;
  webAvailability: "available" | "unavailable" | "unknown";
};

type UnknownRecord = Record<string, unknown>;

export function parseLgrCatalog(html: string, pageUrl = LGR_CATALOG_URL): DiscoveredProduct[] {
  const assignment = /window\.__change\s*\[\s*["']24["']\s*\]\s*=/u.exec(html);
  if (!assignment) return [];
  const start = html.indexOf("{", assignment.index + assignment[0].length);
  if (start < 0) return [];
  const end = findObjectEnd(html, start, MAX_EMBEDDED_CHARS);
  if (end < 0) return [];

  let payload: UnknownRecord;
  try {
    const value: unknown = JSON.parse(html.slice(start, end + 1));
    if (!isRecord(value)) return [];
    payload = value;
  } catch {
    return [];
  }

  const rawProducts = payload.productsData;
  const products = Array.isArray(rawProducts)
    ? rawProducts
    : isRecord(rawProducts) ? Object.values(rawProducts) : [];
  const output: DiscoveredProduct[] = [];
  const seen = new Set<string>();

  for (const raw of products) {
    if (!isRecord(raw)) continue;
    const common = asRecord(raw.common);
    const stock = asRecord(raw.stock);
    const title = firstString(common?.title, raw.title);
    const urlData = asRecord(common?.URL);
    const productUrl = safeProductUrl(firstString(urlData?.canonical, raw.url), pageUrl);
    if (!title || !productUrl || seen.has(productUrl) || !isPokemonTcgProduct(title)) continue;
    const sku = firstString(stock?.sku, stock?.skuId, raw.sku);
    const visuals = Array.isArray(common?.visuals) ? common.visuals : [];
    const firstVisual = asRecord(visuals[0]);
    const listItem = firstVisual?.listItem;
    const imageData = asRecord(listItem);
    const imageUrl = safeHttpsUrl(firstString(imageData?.src, imageData?.url, listItem, raw.image));
    const price = asRecord(raw.price);
    const rawAvailability = asRecord(stock?.webStore)?.available;
    output.push({
      externalRef: sku ?? productUrl,
      ean: normalizeEan(firstString(raw.ean, stock?.ean)) ?? eanFromUrl(productUrl),
      title: title.replace(/\s+/gu, " ").trim().slice(0, 240),
      imageUrl,
      productUrl,
      priceCents: toPriceCents(price?.valueWithTax ?? raw.priceWithTax ?? raw.price),
      webAvailability: rawAvailability === true || rawAvailability === "true"
        ? "available"
        : rawAvailability === false || rawAvailability === "false" ? "unavailable" : "unknown",
    });
    seen.add(productUrl);
    if (output.length >= 100) break;
  }
  return output;
}

function findObjectEnd(source: string, start: number, maxChars: number): number {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  const endLimit = Math.min(source.length, start + maxChars);
  for (let index = start; index < endLimit; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim();
  }
  return null;
}

function safeProductUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && ["lagranderecre.fr", "www.lagranderecre.fr"].includes(url.hostname.toLowerCase())
      ? stripFragment(url).toString()
      : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === "lagranderecre.fr"
      || host.endsWith(".lagranderecre.fr")
      || host.endsWith(".proximis.com");
    return url.protocol === "https:" && allowed ? stripFragment(url).toString() : null;
  } catch {
    return null;
  }
}

function stripFragment(url: URL): URL {
  const value = new URL(url);
  value.hash = "";
  return value;
}

function normalizeEan(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/gu, "");
  return /^\d{8}$|^\d{12,14}$/u.test(digits) ? digits : null;
}

function eanFromUrl(value: string): string | null {
  const match = /(?:^|\D)(\d{8}|\d{12,14})(?:\D|$)/u.exec(value);
  return normalizeEan(match?.[1] ?? null);
}

function isPokemonTcgProduct(title: string): boolean {
  return /(pok[eé]mon|pok[eé]box)/iu.test(title) && POKEMON_TCG_TITLE.test(title);
}

function toPriceCents(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" ? Number(value.trim().replace(/\s/gu, "").replace(",", ".")) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000 ? Math.round(parsed * 100) : null;
}
