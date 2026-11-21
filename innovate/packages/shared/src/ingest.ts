/**
 * Ingest adapters (SPEC §5.1 Input). Platform links go through an adapter behind one
 * interface; uploads and direct video URLs never need one.
 *
 * Implementations live server-side in ./server/adapters.ts (Vimeo, via its official API) and are
 * enabled by config flags; YouTube and Instagram are deliberately not implemented (their terms).
 */
export interface IngestAdapter {
  id: string;
  canHandle(url: URL): boolean;
  fetchMetadata(url: URL): Promise<{ title: string; platform: string; durationSec?: number }>;
  fetchMedia(url: URL): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }>;
}

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube"],
  [/(^|\.)vimeo\.com$/i, "vimeo"],
];

export function detectPlatform(url: URL): string | null {
  for (const [re, name] of PLATFORMS) if (re.test(url.hostname)) return name;
  return null;
}
