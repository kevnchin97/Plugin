import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { dirs, storage } from "./context";

/**
 * Exports render from the original, so the worker keeps a local copy per reference.
 * The download is atomic; the cache is trimmed to CACHE_MAX_BYTES, least recently used first.
 */
const CACHE_MAX_BYTES = 20 * 1024 ** 3;

export async function localOriginal(referenceId: string, key: string): Promise<string> {
  const dir = join(dirs.cache, referenceId);
  const file = join(dir, key.split("/").pop() ?? "original");
  if (existsSync(file)) {
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    return file;
  }
  await mkdir(dir, { recursive: true });
  await storage.downloadFile(key, file);
  void trimCache();
  return file;
}

async function trimCache() {
  const entries = await readdir(dirs.cache).catch(() => [] as string[]);
  const files: { dir: string; size: number; mtime: number }[] = [];
  for (const e of entries) {
    const d = join(dirs.cache, e);
    for (const f of await readdir(d).catch(() => [] as string[])) {
      const s = await stat(join(d, f)).catch(() => null);
      if (s) files.push({ dir: d, size: s.size, mtime: s.mtimeMs });
    }
  }
  let total = files.reduce((a, f) => a + f.size, 0);
  for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= CACHE_MAX_BYTES) break;
    await rm(f.dir, { recursive: true, force: true });
    total -= f.size;
  }
}
