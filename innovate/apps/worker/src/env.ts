import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { availableParallelism } from "node:os";
import { config } from "dotenv";
import { z } from "zod";

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: resolve(root, ".env"), quiet: true });
process.env.INNOVATE_ROOT ??= root;

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  WORKER_TMP_DIR: z.string().default(".data/worker"),
  /** Parallel chunks per ingest; defaults to the CPU count. */
  INGEST_PARALLELISM: z.coerce.number().int().min(1).max(64).default(availableParallelism()),
  INGEST_MAX_BYTES: z.coerce.number().int().positive().default(4 * 1024 ** 3),
  INGEST_ALLOW_PRIVATE_URLS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

// Treat `KEY=` (empty, as in .env.example) as unset so defaults apply.
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  console.error("Invalid worker environment:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  WORKER_TMP_DIR: resolve(root, parsed.data.WORKER_TMP_DIR),
};
