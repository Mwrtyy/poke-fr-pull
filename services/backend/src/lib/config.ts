import "dotenv/config";

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 8787),
  corsOrigins: (process.env.API_CORS_ORIGINS ?? "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean),
  discoveryIntervalMs: positiveNumber(process.env.DISCOVERY_INTERVAL_MS, 6 * 60 * 60 * 1000),
  productCheckIntervalMs: positiveNumber(process.env.PRODUCT_CHECK_INTERVAL_MS, 60 * 60 * 1000),
  maxDiscoveredUrlsPerCycle: Math.min(100, positiveNumber(process.env.MAX_DISCOVERED_URLS_PER_CYCLE, 40)),
  minHostIntervalMs: positiveNumber(process.env.MIN_HOST_INTERVAL_MS, 10_000),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "",
};

export function requireEnv(value: string, name: string) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : fallback;
}
