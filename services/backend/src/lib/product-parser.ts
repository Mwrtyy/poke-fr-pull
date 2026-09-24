import * as JSON5 from "json5";
import { load } from "cheerio";
import { normalizeWebAvailability } from "./evidence.js";
import type { RetailerId, RetailerProduct, WebAvailability } from "./contracts.js";

type UnknownRecord = Record<string, unknown>;

export function parseRetailerProduct(input: {
  retailerId: RetailerId;
  html: string;
  url: string;
  now?: Date;
}): RetailerProduct | null {
  const $ = load(input.html);
  const jsonLd = readJsonLd($);
  const ldProduct = findProductObject(jsonLd);
  const lgrProduct = input.retailerId === "la-grande-recre" ? readLgrProduct(input.html, input.url) : null;
  const title = firstString(
    lgrProduct?.title,
    ldProduct?.name,
    $("h1").first().text(),
    $("meta[property='og:title']").attr("content"),
  );
  if (!title) return null;

  const canonical = firstString(lgrProduct?.productUrl, $("link[rel='canonical']").attr("href"), $("meta[property='og:url']").attr("content"), input.url);
  const productUrl = safeHttpsUrl(canonical, input.url) ?? input.url;
  const rawSku = firstString(lgrProduct?.retailerSku, ldProduct?.sku, ldProduct?.productID, $("[itemprop='sku']").attr("content"), skuFromUrl(productUrl));
  const ean = firstString(lgrProduct?.ean, ldProduct?.gtin13, ldProduct?.gtin, $("meta[itemprop='gtin13']").attr("content"), eanFromText(`${productUrl} ${$("body").text().slice(0, 5000)}`));
  const imageUrl = safeHttpsUrl(firstString(lgrProduct?.imageUrl, imageFromLd(ldProduct?.image), $("meta[property='og:image']").attr("content"), $("img[itemprop='image']").attr("src"), $("img[data-src]").first().attr("data-src"), $("img[src]").first().attr("src")), productUrl);
  const priceValue = lgrProduct?.priceCents ?? toPrice(firstString(
    offerValue(ldProduct?.offers),
    $("meta[property='product:price:amount']").attr("content"),
    $("[itemprop='price']").attr("content"),
    $(".product-price, .price").first().text(),
  ));
  const webAvailability = lgrProduct?.webAvailability ?? normalizeWebAvailability(offerAvailability(ldProduct?.offers));

  return {
    retailerId: input.retailerId,
    retailerSku: rawSku,
    ean: normalizeEan(ean),
    title: title.replace(/\s+/g, " ").trim().slice(0, 240),
    imageUrl,
    productUrl,
    priceCents: priceValue,
    webAvailability,
    discoveredAt: (input.now ?? new Date()).toISOString(),
    sourceUrl: input.url,
  };
}

export function parseProductLinks(html: string, pageUrl: string, hosts: string[]): string[] {
  const $ = load(html);
  const links = new Set<string>();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href) return;
    const url = safeHttpsUrl(href, pageUrl);
    if (!url) return;
    const parsed = new URL(url);
    if (!hosts.includes(parsed.hostname.toLowerCase())) return;
    const context = `${href} ${$(anchor).text()} ${$(anchor).attr("title") ?? ""}`.toLocaleLowerCase("fr-FR");
    if (!/(pokemon|pokémon|carte|cartes|tcg|coffret)/i.test(context)) return;
    if (/\.(?:jpg|jpeg|png|webp|svg|pdf)(?:\?|$)/i.test(parsed.pathname)) return;
    links.add(stripFragment(parsed).toString());
  });
  return [...links].slice(0, 200);
}

export function parseLgrListing(html: string, pageUrl: string, now = new Date()): RetailerProduct[] {
  const data = assignmentObject(html, /window\.__change\s*\[\s*['"]24['"]\s*\]\s*=/);
  if (!data) return [];
  const products = asArray(data.productsData);
  return products.map((product) => productFromLgr(product, pageUrl, now)).filter((item): item is RetailerProduct => item !== null);
}

export function parseKingJouetListing(html: string, pageUrl: string, now = new Date()): RetailerProduct[] {
  const $ = load(html);
  const results: RetailerProduct[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href || !/(pokemon|pokémon|carte|cartes|tcg)/i.test(`${href} ${$(anchor).text()}`)) return;
    const url = safeHttpsUrl(href, pageUrl);
    if (!url || seen.has(url)) return;
    const parent = $(anchor).closest("article, li, .product, .product-item, .product-list-item");
    const title = firstString($(anchor).attr("title"), parent.find("h2,h3,.product-title").first().text(), $(anchor).text());
    if (!title || title.trim().length < 3) return;
    const text = parent.text().toLocaleLowerCase("fr-FR");
    const product = parseRetailerProduct({ retailerId: "king-jouet", html: `<html><head><meta property="og:title" content="${escapeAttribute(title)}"></head><body>${parent.html() ?? ""}</body></html>`, url, now });
    if (product) {
      product.webAvailability = /web\s*en stock|disponible sur le web|livraison.*disponible/i.test(text) ? "available" : /web\s*indisponible|indisponible.*livraison/i.test(text) ? "unavailable" : product.webAvailability;
      // « Vérifier le stock » is not proof of a store-level result.
      results.push(product);
      seen.add(url);
    }
  });
  return results;
}

function productFromLgr(value: unknown, pageUrl: string, now: Date): RetailerProduct | null {
  const product = record(value);
  const common = record(product?.common);
  const stock = record(product?.stock);
  const context = record(product?.context);
  const urlData = record(common?.URL);
  const visuals = asArray(common?.visuals);
  const firstVisual = record(visuals[0]);
  const title = firstString(common?.title, product?.title);
  if (!title) return null;
  const canonical = safeHttpsUrl(firstString(urlData?.canonical, product?.url), pageUrl) ?? pageUrl;
  const sku = firstString(stock?.sku, stock?.skuId, product?.sku);
  const price = toPrice(firstString(record(product?.price)?.valueWithTax, product?.priceWithTax, product?.price));
  const image = safeHttpsUrl(firstString(record(firstVisual?.listItem)?.src, record(firstVisual?.listItem)?.url, firstVisual?.listItem, product?.image), canonical);
  const rawAvailability = record(stock?.webStore)?.available;
  let webAvailability: WebAvailability = "unknown";
  if (rawAvailability === true || rawAvailability === "true") webAvailability = "available";
  else if (rawAvailability === false || rawAvailability === "false") webAvailability = "unavailable";
  // context.data.storeId = 0 refers to no selected shop; never use it as local evidence.
  void context;
  return {
    retailerId: "la-grande-recre",
    retailerSku: sku,
    ean: normalizeEan(firstString(product?.ean, stock?.ean, eanFromText(canonical))),
    title: title.replace(/\s+/g, " ").trim().slice(0, 240),
    imageUrl: image,
    productUrl: canonical,
    priceCents: price,
    webAvailability,
    discoveredAt: now.toISOString(),
    sourceUrl: pageUrl,
  };
}

function readLgrProduct(html: string, pageUrl: string) {
  const products = parseLgrListing(html, pageUrl);
  const requested = stripFragment(new URL(pageUrl)).toString();
  return products.find((product) => stripFragment(new URL(product.productUrl)).toString() === requested) ?? null;
}

function readJsonLd($: ReturnType<typeof load>): unknown[] {
  const values: unknown[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      values.push(JSON.parse($(element).text()) as unknown);
    } catch {
      // A malformed JSON-LD block does not become evidence.
    }
  });
  return values;
}

function findProductObject(values: unknown[]): UnknownRecord | null {
  const visit = (value: unknown): UnknownRecord | null => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }
    const object = record(value);
    if (!object) return null;
    const type = object["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return object;
    if (object["@graph"]) return visit(object["@graph"]);
    return null;
  };
  for (const value of values) {
    const found = visit(value);
    if (found) return found;
  }
  return null;
}

function assignmentObject(html: string, assignment: RegExp): UnknownRecord | null {
  const match = assignment.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  const end = findBalancedObjectEnd(html, start);
  if (end < 0) return null;
  try {
    const serialized = html.slice(start, end + 1);
    try {
      return record(JSON.parse(serialized) as unknown);
    } catch {
      return record(JSON5.parse(serialized) as unknown);
    }
  } catch {
    return null;
  }
}

function findBalancedObjectEnd(source: string, start: number) {
  const opening = source.indexOf("{", start);
  if (opening < 0) return -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = opening; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = record(value);
  return object ? Object.values(object) : [];
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function offerValue(value: unknown): unknown {
  const offers = Array.isArray(value) ? value[0] : value;
  return record(offers)?.price;
}

function offerAvailability(value: unknown): unknown {
  const offers = Array.isArray(value) ? value[0] : value;
  return record(offers)?.availability;
}

function imageFromLd(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return imageFromLd(value[0]);
  const object = record(value);
  return object ? firstString(object.url, object.contentUrl) : null;
}

function toPrice(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".").replace(/[^0-9.]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function safeHttpsUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? stripFragment(url).toString() : null;
  } catch {
    return null;
  }
}

function stripFragment(url: URL) {
  const copy = new URL(url);
  copy.hash = "";
  return copy;
}

function normalizeEan(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return /^\d{8}$|^\d{12,14}$/.test(digits) ? digits : null;
}

function eanFromText(value: string): string | null {
  return value.match(/(?:^|\D)(\d{13,14})(?:\D|$)/)?.[1] ?? null;
}

function skuFromUrl(value: string): string | null {
  const matches = value.match(/(?:ref-|sku[-_/])([a-z0-9-]+)/i);
  return matches?.[1] ?? null;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
