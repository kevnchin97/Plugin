"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTimecode, REFERENCE_TYPES, SEARCH_SOURCES, secondsToFrame } from "@innovate/shared";
import { aspectOf, ReferenceBody } from "@/components/board/cards";
import { MotionMedia } from "@/components/media/MotionMedia";
import type { SearchHit } from "@/lib/search";

const TYPE_LABEL: Record<string, string> = { image: "Images", gif: "GIFs", clip: "Clips", still: "Stills", video: "Videos", link: "Links", note: "Notes" };
const SOURCE_LABEL: Record<string, string> = { upload: "Uploads", web: "Saved from the web", vimeo: "Vimeo", export: "Made in GIF Maker" };
const EXAMPLES = ["warm orange dusk light", "pink and teal neon", "a fractal", "glowing embers in the dark", "scattered gold dots on purple"];

type Result = { hits: SearchHit[]; semantic: boolean; tookMs: number } | { error: string };

/** CLIP cosine values are small and bunched, so label each hit relative to the best one. */
function strength(sim: number | null, top: number): string | null {
  if (sim === null) return null;
  if (sim >= top - 0.012) return "Strong match";
  if (sim >= top - 0.03) return "Good match";
  return "Related";
}

function matchHref(hit: SearchHit): string | null {
  const r = hit.reference;
  if (r.type !== "video" || hit.time === null || !r.fps) return null;
  return `/make/${r.id}?in=${secondsToFrame(hit.time, r.fps)}`;
}

/**
 * Natural-language library search (SPEC §5.6). The query is the URL (?q, type, board, source,
 * from, to), so results are linkable and the back button works.
 */
export function SearchView({ boards }: { boards: { id: string; title: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const key = params.toString();
  const [result, setResult] = useState<{ key: string; data: Result } | null>(null);
  const [open, setOpen] = useState<SearchHit | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) return;
    const ctrl = new AbortController();
    fetch(`/api/search?${key}`, { signal: ctrl.signal })
      .then(async (res) => ({ key, data: (await res.json()) as Result }))
      .then(setResult)
      .catch((err: Error) => err.name !== "AbortError" && setResult({ key, data: { error: "Search didn't respond. Try again." } }));
    return () => ctrl.abort();
  }, [key, q]);

  const set = (name: string, value: string | null, multi = false) => {
    const next = new URLSearchParams(params);
    if (multi) {
      const all = next.getAll(name);
      next.delete(name);
      for (const v of all.includes(value!) ? all.filter((x) => x !== value) : [...all, value!]) next.append(name, v);
    } else if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const types = params.getAll("type");
  const loading = Boolean(q.trim()) && result?.key !== key;
  const data = result?.key === key ? result.data : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-6 pt-6 pb-16">
        <div className="mb-4">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{q ? <>Results for “{q}”</> : "Search"}</h1>
          <p className="text-sm text-text-muted">
            Describe what you&rsquo;re looking for: light, colour, subject, mood. Images and every scene of your videos are matched by what they look like.
          </p>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Filters">
          {REFERENCE_TYPES.filter((t) => t !== "note").map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={types.includes(t)}
              onClick={() => set("type", t, true)}
              className={`h-7 rounded-full border px-3 text-sm ${types.includes(t) ? "border-accent bg-accent-soft text-text" : "border-border text-text-muted hover:text-text"}`}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <select aria-label="Board" value={params.get("board") ?? ""} onChange={(e) => set("board", e.target.value || null)} className="h-7 rounded-md border border-border bg-surface-2 px-2 text-sm">
            <option value="">Any board</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <select aria-label="Source" value={params.get("source") ?? ""} onChange={(e) => set("source", e.target.value || null)} className="h-7 rounded-md border border-border bg-surface-2 px-2 text-sm">
            <option value="">Any source</option>
            {SEARCH_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            Added from
            <input type="date" aria-label="Added from" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value || null)} className="h-7 rounded-md border border-border bg-surface-2 px-2 text-sm text-text" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            to
            <input type="date" aria-label="Added to" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value || null)} className="h-7 rounded-md border border-border bg-surface-2 px-2 text-sm text-text" />
          </label>
        </div>

        {!q && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => set("q", e)} className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-muted hover:text-text">
                {e}
              </button>
            ))}
          </div>
        )}
        {loading && <p className="text-sm text-text-muted" role="status">Searching…</p>}
        {data && "error" in data && (
          <p className="text-sm text-danger" role="alert">
            {data.error}
          </p>
        )}
        {data && "hits" in data && (
          <>
            <p className="mb-3 text-xs text-text-faint" data-testid="search-summary">
              {data.hits.length ? `${data.hits.length} ${data.hits.length === 1 ? "match" : "matches"}` : "No matches"}
              {" · "}
              {data.semantic ? "ranked by what they look like" : "keyword matches only (the image search model isn't running)"} · {data.tookMs} ms
            </p>
            {!data.hits.length && <p className="text-sm text-text-muted">Try fewer words, or describe colour and light instead of a name.</p>}
            <ul className="columns-[240px] gap-3" data-testid="search-results">
              {data.hits.map((hit) => {
                const r = hit.reference;
                const top = Math.max(...data.hits.map((h) => h.similarity ?? 0));
                const label = strength(hit.similarity, top);
                const at = matchHref(hit);
                return (
                  <li key={r.id} className="mb-3 break-inside-avoid" data-testid="search-hit" data-title={r.title}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => (at ? router.push(at) : setOpen(hit))}
                      onKeyDown={(e) => e.key === "Enter" && (at ? router.push(at) : setOpen(hit))}
                      onMouseEnter={() => setHover(r.id)}
                      onMouseLeave={() => setHover(null)}
                      className="cursor-pointer overflow-hidden rounded-md border border-border bg-surface-2 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
                      aria-label={`${r.title}${at ? `, open at the matching scene` : ""}`}
                    >
                      {hit.frameUrl ? (
                        <div className="relative bg-player" style={{ aspectRatio: aspectOf(r) }}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                          <img src={hit.frameUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          <span className="absolute top-2 left-2 rounded-xs bg-black/70 px-1.5 py-px text-2xs font-medium text-white/90">Video</span>
                        </div>
                      ) : (
                        <ReferenceBody reference={r} hovering={hover === r.id} />
                      )}
                      {hit.frameUrl && (
                        <div className="px-2.5 pt-1.5 pb-2">
                          <div className="truncate text-sm leading-[18px]">{r.title}</div>
                        </div>
                      )}
                      <div className="-mt-1 flex flex-wrap items-center gap-x-2 px-2.5 pb-2 text-2xs text-text-faint">
                        {hit.time !== null && r.fps && r.type === "video" && (
                          <span className="font-mono text-accent" data-testid="hit-time">
                            Scene at {formatTimecode(secondsToFrame(hit.time, r.fps), r.fps)}
                          </span>
                        )}
                        {hit.keyword && <span>matches your words</span>}
                        {label && (
                          <span title={`Visual similarity to your description (cosine ${hit.similarity})`} data-testid="hit-strength">
                            {label}
                          </span>
                        )}
                      </div>
                      {hit.description && <p className="line-clamp-2 px-2.5 pb-2 text-xs text-text-muted">{hit.description}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Dialog.Root open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 w-[min(960px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border-strong bg-surface focus:outline-none" data-testid="search-lightbox">
            {open && (
              <>
                <div className="bg-player" style={{ aspectRatio: aspectOf(open.reference) }}>
                  <MotionMedia item={open.reference} active />
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-md font-medium">{open.reference.title}</Dialog.Title>
                    {open.description && <p className="text-sm text-text-muted">{open.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {open.reference.sourceUrl && (
                      <Link href={open.reference.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                        Source
                      </Link>
                    )}
                    <Dialog.Close className="text-sm text-text-muted hover:text-text">Close</Dialog.Close>
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
