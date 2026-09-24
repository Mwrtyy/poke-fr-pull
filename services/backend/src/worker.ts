import { Worker } from "bullmq";
import { adapters, adapterFor } from "./adapters/index.js";
import { config } from "./lib/config.js";
import { pool, query } from "./lib/db.js";
import { SourceBlockedError, fetchPublicPage, listAllowedSitemaps } from "./lib/http.js";
import type { RetailerAdapter, RetailerProduct } from "./lib/contracts.js";
import { finishMonitorRun, saveUnknownProduct, startMonitorRun } from "./lib/persistence.js";
import { redis } from "./lib/redis.js";
import { QUEUE_NAME, queue } from "./queue.js";

async function runDiscovery(retailerId: string) {
  const adapter = adapterFor(retailerId);
  if (!adapter) throw new Error(`Unknown retailer: ${retailerId}`);
  const candidateUrls = adapter.startUrls.length ? adapter.startUrls : await discoverFromSitemaps(adapter);
  if (!candidateUrls.length) {
    const runId = await startMonitorRun(adapter.id, null, "discovery");
    await finishMonitorRun({ id: runId, status: "blocked", productsSeen: 0, message: "No verified discovery URL or Pokémon URL in public sitemap." });
    console.info(`[${adapter.id}] skipped: no verified discovery URL or product URL in public sitemaps.`);
    return;
  }

  let productsSeen = 0;
  let failures = 0;
  const maxProducts = Math.min(15, config.maxDiscoveredUrlsPerCycle);
  for (const sourceUrl of candidateUrls.slice(0, 5)) {
    const runId = await startMonitorRun(adapter.id, sourceUrl, "discovery");
    try {
      const page = await fetchPublicPage({ url: sourceUrl, adapter, redisRateLimit: true });
      if (page.status === 403 || page.status === 429) {
        failures++;
        await finishMonitorRun({ id: runId, status: "blocked", productsSeen: 0, message: `source_http_${page.status}` });
        continue;
      }
      if (page.status !== 200) throw new Error(`source_http_${page.status}`);

      const pageProducts = parsePageProducts(adapter, page.text, page.url);
      for (const product of pageProducts.slice(0, maxProducts)) {
        await saveUnknownProduct({ ...product, discoveredAt: new Date().toISOString() });
        productsSeen++;
      }

      const remaining = Math.max(0, maxProducts - pageProducts.length);
      if (remaining > 0) {
        for (const productUrl of adapter.parseListing(page.text, page.url).productLinks.slice(0, remaining)) {
          try {
            const productPage = await fetchPublicPage({ url: productUrl, adapter, redisRateLimit: true });
            if (productPage.status !== 200) {
              failures++;
              continue;
            }
            const product = adapter.parseProduct(productPage.text, productPage.url);
            if (!product) continue;
            await saveUnknownProduct({ ...product, discoveredAt: new Date().toISOString() });
            productsSeen++;
          } catch (error) {
            failures++;
            if (error instanceof SourceBlockedError) continue;
            throw error;
          }
        }
      }

      await finishMonitorRun({
        id: runId,
        status: failures ? "partial" : "ok",
        productsSeen,
        message: "Product catalog refreshed. Store status remains unknown unless an exact-store proof is parsed.",
        details: { parser: adapter.parseListing(page.text, page.url).parser, robots: page.robotsReason },
      });
    } catch (error) {
      failures++;
      const blocked = error instanceof SourceBlockedError;
      const message = error instanceof Error ? error.message.slice(0, 200) : "unknown_monitor_error";
      await finishMonitorRun({ id: runId, status: blocked ? "blocked" : "failed", productsSeen: 0, message });
    }
  }
  console.info(`[${adapter.id}] catalog discovery ended: ${productsSeen} products, ${failures} blocked or failed fetches; store availability remains unknown.`);
}

function parsePageProducts(adapter: RetailerAdapter, html: string, url: string): RetailerProduct[] {
  const direct = adapter.parseProduct(html, url);
  const path = new URL(url).pathname;
  const productPath = /\/p\/|ref-|\/a\d+/i.test(path);
  if (direct && productPath) return [direct];
  return adapter.parseListing(html, url).products;
}

async function discoverFromSitemaps(adapter: RetailerAdapter) {
  const root = new URL("/", `https://${adapter.hosts[0]}`);
  const sitemaps = await listAllowedSitemaps(root);
  const productUrls = new Set<string>();
  for (const sitemapUrl of sitemaps.slice(0, 3)) {
    try {
      const page = await fetchPublicPage({ url: sitemapUrl, adapter, redisRateLimit: true, sitemapsAllowed: true });
      if (page.status !== 200 || !/xml|text\/plain/i.test(page.contentType)) continue;
      for (const value of [...page.text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, "&"))) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          continue;
        }
        if (!adapter.hosts.includes(url.hostname.toLowerCase())) continue;
        if (/(pokemon|pokémon|tcg|cartes?)/i.test(`${url.pathname} ${url.search}`)) productUrls.add(url.toString());
      }
    } catch (error) {
      if (!(error instanceof SourceBlockedError)) console.warn(`[${adapter.id}] public sitemap skipped: ${String(error).slice(0, 120)}`);
    }
  }
  return [...productUrls].slice(0, Math.min(20, config.maxDiscoveredUrlsPerCycle));
}

for (const adapter of adapters) {
  await queue.upsertJobScheduler(
    `discovery-${adapter.id}`,
    { every: config.discoveryIntervalMs },
    { name: "discover-retailer", data: { retailerId: adapter.id } },
  );
  await queue.add("discover-retailer", { retailerId: adapter.id }, {
    jobId: `initial-discovery-${adapter.id}`,
    removeOnComplete: false,
    removeOnFail: 100,
  });
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== "discover-retailer") throw new Error(`Unknown job: ${job.name}`);
    await runDiscovery(String(job.data.retailerId));
  },
  { connection: redis, concurrency: 2, limiter: { max: 2, duration: 1000 } },
);

worker.on("completed", (job) => console.info(`monitor job completed: ${job.name}`));
worker.on("failed", (job, error) => console.error(`monitor job failed: ${job?.name}: ${error.message}`));
worker.on("error", (error) => console.error(`worker error: ${error.message}`));

console.info(`Retailer discovery worker started; schedule interval ${config.discoveryIntervalMs} ms.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    await queue.close();
    await pool.end();
    await redis.quit();
    process.exit(0);
  });
}
