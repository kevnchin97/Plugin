import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

declare global {
  var __innovateDb: { db: Db; close(): Promise<void> } | undefined;
}

/** `pglite:<dir>`: the desktop app's embedded Postgres (PGlite, in this process) instead of a server. */
export const isEmbeddedDb = (url = process.env.DATABASE_URL) => !!url?.startsWith("pglite:");

/**
 * One pool per process (survives Next.js dev hot reloads). The desktop app opens the embedded
 * database with `openEmbeddedDb()` before anything else runs, so this only ever returns it.
 */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  if (!globalThis.__innovateDb) {
    if (isEmbeddedDb(url)) throw new Error("The embedded database isn't open yet (openEmbeddedDb() runs at desktop start-up).");
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), onnotice: () => {} });
    globalThis.__innovateDb = { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
  }
  return globalThis.__innovateDb.db;
}

/**
 * Open (creating and migrating on first run) the embedded database for the desktop app. PGlite is
 * the real Postgres compiled to WebAssembly, with pgvector; it runs in this process and serialises
 * queries, so everything that uses the database must live in the same process.
 */
export async function openEmbeddedDb(dir: string, migrationsFolder: string): Promise<Db> {
  if (globalThis.__innovateDb) return globalThis.__innovateDb.db;
  const [{ PGlite }, { vector }, { drizzle: drizzlePglite }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-pgvector"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = await PGlite.create(dir, { extensions: { vector } });
  await client.exec("create extension if not exists vector");
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder });
  // Same query builder API; the one difference (execute() returns { rows }) is handled in rows().
  globalThis.__innovateDb = { db: db as unknown as Db, close: () => client.close() };
  return globalThis.__innovateDb.db;
}

/** Rows from `db.execute()`, whichever driver ran it (postgres-js returns an array, PGlite { rows }). */
export function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

export async function closeDb(): Promise<void> {
  if (globalThis.__innovateDb) {
    await globalThis.__innovateDb.close();
    globalThis.__innovateDb = undefined;
  }
}
