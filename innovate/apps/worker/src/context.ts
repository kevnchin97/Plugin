import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@innovate/db";
import { storageFromEnv } from "@innovate/shared/storage";
import { redisOptions } from "@innovate/shared/queue";
import { env } from "./env";

export const db = getDb(env.DATABASE_URL);
export const storage = storageFromEnv();
export const dirs = {
  cache: join(env.WORKER_TMP_DIR, "cache"),
  work: join(env.WORKER_TMP_DIR, "work"),
};
mkdirSync(dirs.cache, { recursive: true });
mkdirSync(dirs.work, { recursive: true });

export function redisConnection() {
  return redisOptions(env.REDIS_URL);
}
