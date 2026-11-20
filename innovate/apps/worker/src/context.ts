import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@innovate/db";
import { Storage, storageConfigFromEnv } from "@innovate/shared/storage";
import { env } from "./env";

export const db = getDb(env.DATABASE_URL);
export const storage = new Storage(storageConfigFromEnv());
export const dirs = {
  cache: join(env.WORKER_TMP_DIR, "cache"),
  work: join(env.WORKER_TMP_DIR, "work"),
};
mkdirSync(dirs.cache, { recursive: true });
mkdirSync(dirs.work, { recursive: true });

export function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
