"use client";
import { useMemo, useState } from "react";
import { BoardBody, LinkBody, NoteBody, ReferenceBody } from "./cards";
import { inverseUpdates, type Item, type BoardStore } from "./useBoard";

/**
 * Grid view: the same board as a masonry of native-ratio cards, grouped by column.
 * Click to select (Shift/⌘ for more), then move the selection into a column or delete it.
 */
export function BoardGrid({ store }: { store: BoardStore }) {
  const { items, commit, boardId } = store;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const list = useMemo(() => [...items.values()], [items]);
  const columns = list.filter((i) => i.kind === "column").sort((a, b) => a.x - b.x || a.y - b.y);
  const loose = list.filter((i) => !i.columnId && i.kind !== "column" && i.kind !== "arrow").sort((a, b) => a.y - b.y || a.x - b.x);
  const sections = [
    ...columns.map((c) => ({ id: c.id, title: c.content.title || "Untitled column", items: list.filter((i) => i.columnId === c.id).sort((a, b) => a.position - b.position) })),
    { id: "loose", title: columns.length ? "On the canvas" : "", items: loose },
  ].filter((s) => s.items.length || s.id !== "loose");

  const toggle = (id: string, e: React.MouseEvent | React.KeyboardEvent) =>
    setSelected((cur) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const n = new Set(cur);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }
      return cur.has(id) && cur.size === 1 ? new Set() : new Set([id]);
    });

  const moveTo = (columnId: string | null) => {
    const ids = [...selected];
    let pos = Math.max(0, ...list.filter((i) => i.columnId === columnId).map((i) => i.position)) + 1024;
    const updates = ids.map((id, n) => (columnId ? { id, columnId, position: (pos += 1024) } : { id, columnId: null, x: 40 + n * 24, y: 40 + n * 24 }));
    commit({ update: updates }, { update: inverseUpdates(items, updates, boardId) }, "Move");
    setSelected(new Set());
  };

  const body = (it: Item) =>
    it.kind === "reference" ? (
      <ReferenceBody reference={it.referenceId ? store.references[it.referenceId] : undefined} hovering={hover === it.id} />
    ) : it.kind === "note" ? (
      <NoteBody text={it.content.text ?? ""} editing={false} onDone={() => {}} />
    ) : it.kind === "link" ? (
      <LinkBody url={it.content.url} title={it.content.title} host={it.content.host} editing={false} onDone={() => {}} />
    ) : it.kind === "board" ? (
      <BoardBody title={store.childBoards[it.childBoardId ?? ""]?.title ?? "Board"} cover={store.childBoards[it.childBoardId ?? ""]?.cover ?? []} count={store.childBoards[it.childBoardId ?? ""]?.count ?? 0} />
    ) : null;

  return (
    <div className="relative min-w-0 flex-1 overflow-y-auto" data-testid="board-grid">
      <div className="mx-auto max-w-[1600px] px-6 py-5">
        {sections.map((s) => (
          <section key={s.id} className="mb-8">
            {s.title && (
              <h2 className="mb-3 text-sm font-semibold">
                {s.title} <span className="ml-1 font-normal text-text-faint">{s.items.length}</span>
              </h2>
            )}
            <ul className="columns-[240px] gap-3">
              {s.items.map((it) => (
                <li key={it.id} className="mb-3 break-inside-avoid">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected.has(it.id)}
                    onClick={(e) => toggle(it.id, e)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(it.id, e))}
                    onMouseEnter={() => setHover(it.id)}
                    onMouseLeave={() => setHover(null)}
                    data-testid="grid-card"
                    className={`overflow-hidden rounded-md border bg-surface ${selected.has(it.id) ? "border-accent outline outline-2 outline-offset-1 outline-accent" : "border-border"}`}
                  >
                    {body(it)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <p className="py-20 text-center text-text-muted">Nothing on this board yet.</p>}
      </div>
      {selected.size > 0 && (
        <div className="sticky bottom-4 mx-auto flex w-fit items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-[0_12px_30px_rgba(33,29,24,0.16)]" role="toolbar" aria-label="Selection">
          <span className="text-text-muted">{selected.size} selected</span>
          <select
            aria-label="Move selection to"
            className="h-7 rounded-sm border border-border-strong bg-surface-2 px-2 text-sm"
            value=""
            onChange={(e) => e.target.value && moveTo(e.target.value === "loose" ? null : e.target.value)}
          >
            <option value="">Move to…</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.content.title || "Untitled column"}
              </option>
            ))}
            <option value="loose">Canvas (no column)</option>
          </select>
          <button
            type="button"
            className="h-7 rounded-sm px-2 text-danger hover:bg-danger/10"
            onClick={() => {
              const ids = [...selected].filter((id) => items.get(id)?.kind !== "board");
              commit({ delete: ids }, { create: ids.map((id) => items.get(id)!).map((i) => ({ ...i, referenceId: i.referenceId, childBoardId: i.childBoardId })) }, "Delete");
              setSelected(new Set());
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
