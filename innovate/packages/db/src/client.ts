import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

declare global {
  var __innovateDb: { db: Db; sql: postgres.Sql } | undefined;
}

/** One pool per process (survives Next.js dev hot reloads). */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  if (!globalThis.__innovateDb) {
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), onnotice: () => {} });
    globalThis.__innovateDb = { db: drizzle(client, { schema }), sql: client };
  }
  return globalThis.__innovateDb.db;
}

export async function closeDb(): Promise<void> {
  if (globalThis.__innovateDb) {
    await globalThis.__innovateDb.sql.end({ timeout: 5 });
    globalThis.__innovateDb = undefined;
  }
}
