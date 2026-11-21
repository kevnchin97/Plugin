import "server-only";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

// One .env for the whole monorepo (innovate/.env). Next only reads apps/web/.env by itself.
const root = resolve(process.cwd(), "../..");
if (existsSync(resolve(root, "pnpm-workspace.yaml"))) {
  loadEnvConfig(root, process.env.NODE_ENV !== "production");
  process.env.INNOVATE_ROOT ??= root;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  EMAIL_SERVER: z.string().optional(),
  EMAIL_FROM: z.string().default("Innovate <login@localhost>"),
  MAGIC_LINK_LOG_FILE: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;

/** Parsed lazily so `next build` doesn't need a full runtime environment. */
export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) throw new Error("Invalid web environment:\n" + z.prettifyError(parsed.error));
    const file = parsed.data.MAGIC_LINK_LOG_FILE;
    cached = { ...parsed.data, MAGIC_LINK_LOG_FILE: file ? resolve(root, file) : undefined };
  }
  return cached;
}
