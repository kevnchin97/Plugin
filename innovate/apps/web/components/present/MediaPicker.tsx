"use client";
import { useEffect, useState } from "react";
import { aspectOf } from "@/components/board/cards";
import { MotionMedia } from "@/components/media/MotionMedia";
import type { RefLite } from "@/lib/boards";

/**
 * Pick references for a slide, reel or portfolio: the source board's references first, then
 * the library (newest) or a natural-language search over it.
 */
export function MediaPicker({
  boardId,
  boards,
  accept,
  onPick,
  label = "Add",
}: {
  boardId?: string | null;
  boards: { id: string; title: string }[];
  accept: (r: RefLite) => boolean;
  onPick(r: RefLite): void;
  label?: string;
}) {
  const [source, setSource] = useState<string>(boardId ?? "library");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RefLite[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let refs: RefLite[] = [];
      if (query) {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}${source !== "library" ? `&board=${source}` : ""}`);
        if (r.ok) refs = ((await r.json()).hits as { reference: RefLite }[]).map((h) => h.reference);
      } else if (source === "library") {
        const r = await fetch("/api/references?limit=150");
        if (r.ok) refs = (await r.json()).references as RefLite[];
      } else {
        const r = await fetch(`/api/boards/${source}`);
        if (r.ok) refs = Object.values(((await r.json()) as { references: Record<string, RefLite> }).references);
      }
      if (!cancelled) setItems(refs.filter((x) => x.status === "ready" && accept(x)));
    })();
    return () => {
      cancelled = true;
    };
    // `accept` is a stable filter per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="media-picker">
      <div className="space-y-2 p-3">
        <select aria-label="References from" value={source} onChange={(e) => { setItems(null); setSource(e.target.value); }} className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-sm">
          <option value="library">Library</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              Board: {b.title}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setItems(null);
            setQuery(q.trim());
          }}
        >
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by look…" aria-label="Search references" className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-sm placeholder:text-text-faint" />
        </form>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {items === null ? (
          <p className="text-xs text-text-faint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-text-faint">Nothing here that fits.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  aria-label={`${label} ${r.title}`}
                  className="block w-full overflow-hidden rounded-sm border border-border bg-surface-2 text-left hover:border-accent"
                  data-testid="picker-item"
                >
                  <div className="bg-player" style={{ aspectRatio: aspectOf(r) }}>
                    <MotionMedia item={r} active={hover === r.id} />
                  </div>
                  <div className="truncate px-1.5 py-1 text-2xs text-text-muted">{r.title}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
