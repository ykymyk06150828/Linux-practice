import { Redis } from "ioredis";
import type { AppConfig } from "../config.js";

let client: Redis | null = null;

export function getRedis(config: AppConfig): Redis {
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 20,
      retryStrategy(times: number) {
        return Math.min(times * 100, 3000);
      },
    });
  }
  return client;
}
