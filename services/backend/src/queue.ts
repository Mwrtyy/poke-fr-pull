import { Queue } from "bullmq";
import { redis } from "./lib/redis.js";

export const QUEUE_NAME = "poke-fr-monitor";
export const queue = new Queue(QUEUE_NAME, { connection: redis });
