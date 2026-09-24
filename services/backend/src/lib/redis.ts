import { Redis } from "ioredis";
import { config, requireEnv } from "./config.js";

export const redis = new Redis(requireEnv(config.redisUrl, "REDIS_URL"), {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

export async function waitForHostSlot(host: string, crawlDelayMs: number) {
  const interval = Math.max(config.minHostIntervalMs, crawlDelayMs);
  const key = `host-rate:${host}`;
  for (;;) {
    const acquired = await redis.set(key, String(Date.now()), "PX", interval, "NX");
    if (acquired === "OK") return;
    const ttl = await redis.pttl(key);
    await new Promise((resolve) => setTimeout(resolve, Math.max(150, ttl > 0 ? ttl : 500)));
  }
}
