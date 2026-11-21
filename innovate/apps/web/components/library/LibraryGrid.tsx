"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReferenceBody, aspectOf } from "@/components/board/cards";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";

const GAP = 12;
const MIN_COL = 240;
const CAPTION = 46;

/**
 * Virtualized masonry (TanStack Virtual lanes): only the cards near the viewport are in the DOM,
 * so 5,000+ references stay interactive. Every card keeps its native aspect ratio.
 */
export function LibraryGrid({ initial, next: firstNext, boards }: { initial: RefLite[]; next: string | null; boards: { id: string; title: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(firstNext);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(1600, el.clientWidth) - 48));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pull the rest of the library in the background, 1,000 at a time.
  useEffect(() => {
    if (!next) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/references?limit=1000&before=${encodeURIComponent(next)}`);
      if (!res.ok || cancelled) return;
      const page = (await res.json()) as { references: RefLite[]; next: string | null };
      setItems((cur) => [...cur, ...page.references]);
      setNext(page.next);
    })();
    return () => {
      cancelled = true;
    };
  }, [next]);

  const lanes = Math.max(1, Math.floor((width + GAP) / (MIN_COL + GAP)));
  const colW = lanes ? (width - GAP * (lanes - 1)) / lanes : MIN_COL;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => colW / aspectOf(items[i]) + CAPTION + GAP,
    lanes,
    overscan: 8,
    gap: 0,
  });
  useEffect(() => virtualizer.measure(), [colW, lanes, virtualizer]);

  const select = useCallback(
    (index: number, e: React.MouseEvent | React.KeyboardEvent) => {
      const id = items[index]!.id;
      setSelected((cur) => {
        if (e.shiftKey && anchor.current !== null) {
          const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
          return new Set([...cur, ...items.slice(a, b + 1).map((i) => i.id)]);
        }
        anchor.current = index;
        if (e.metaKey || e.ctrlKey) {
          const n = new Set(cur);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }
        return cur.has(id) && cur.size === 1 ? new Set() : new Set([id]);
      });
    },
    [items],
  );

  const addToBoard = async (boardId: string) => {
    const refs = [...selected];
    const create = refs.map((referenceId, n) => ({
      id: crypto.randomUUID(),
      kind: "reference",
      referenceId,
      x: 40 + (n % 5) * 264,
      y: 40 + Math.floor(n / 5) * 220,
      w: 240,
      z: n + 1,
    }));
    const res = await fetch(`/api/boards/${boardId}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ create }) });
    if (!res.ok) return toast("Couldn't add them to that board.", "error");
    toast(`Added ${refs.length} to ${boards.find((b) => b.id === boardId)?.title ?? "board"}`, "success");
    setSelected(new Set());
  };

  return (
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto" data-testid="library">
      {items.length === 0 ? (
        <div className="mx-6 grid min-h-[360px] place-items-center rounded-lg border border-dashed border-border-strong text-center">
          <div>
            <p className="text-md">Start with a video.</p>
            <p className="mt-1 text-sm text-text-muted">Upload footage, find the moment, and save stills, GIFs and clips here.</p>
            <Link href="/make" className="mt-4 inline-block text-sm text-accent hover:underline">
              Open the GIF Maker →
            </Link>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto max-w-[1600px] px-6" style={{ height: virtualizer.getTotalSize() + 24 }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index]!;
            const parent = item.parentReferenceId ? byId.get(item.parentReferenceId) : undefined;
            const isSel = selected.has(item.id);
            return (
              <div
                key={item.id}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="absolute"
                style={{ top: v.start, left: 24 + v.lane * (colW + GAP), width: colW, paddingBottom: GAP }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSel}
                  aria-label={item.title}
                  data-testid="library-item"
                  data-type={item.type}
                  onClick={(e) => select(v.index, e)}
                  onDoubleClick={() => item.type === "video" && router.push(`/make/${item.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === " ") {
                      e.preventDefault();
                      select(v.index, e);
                    }
                    if (e.key === "Enter" && item.type === "video") router.push(`/make/${item.id}`);
                  }}
                  onMouseEnter={() => setHover(item.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(item.id)}
                  onBlur={() => setHover(null)}
                  className={`overflow-hidden rounded-md border bg-surface transition-colors ${isSel ? "border-accent outline outline-2 outline-offset-1 outline-accent" : "border-border hover:border-border-strong"}`}
                >
                  <ReferenceBody reference={item} parentTitle={parent?.title} hovering={hover === item.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 mx-auto flex w-fit items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.16)]" role="toolbar" aria-label="Selection">
          <span className="text-text-muted" data-testid="selection-count">
            {selected.size} selected
          </span>
          <select aria-label="Add selection to board" className="h-7 rounded-sm border border-border-strong bg-surface-2 px-2 text-sm" value="" onChange={(e) => e.target.value && void addToBoard(e.target.value)}>
            <option value="">Add to board…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <button type="button" className="h-7 rounded-sm px-2 text-text-muted hover:bg-surface-3" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
