"use client";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLUMN_WIDTH, DEFAULT_CARD_WIDTH, hostOf, type BoardItemPatch, type NewBoardItem, positionBetween } from "@innovate/shared";
import { useFeedbackCounts } from "@/components/feedback/BoardSocial";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";
import { aspectOf, BoardBody, LinkBody, NOTE_SWATCH_CLASS, NoteBody, ReferenceBody, SwatchBody } from "./cards";
import { NOTE_COLORS } from "@innovate/shared";
import { inverseUpdates, type Item, itemToNew, type BoardStore } from "./useBoard";

export type Tool = "note" | "link" | "column" | "board" | "swatch";

interface Props {
  store: BoardStore;
  unsorted: RefLite[];
  onPlacedFromTray(ids: string[]): void;
  onReturnedToTray(refs: RefLite[]): void;
  arrowMode: boolean;
  setArrowMode(v: boolean): void;
  createRef: React.MutableRefObject<((tool: Tool, at?: { x: number; y: number }) => void) | null>;
  zoomRef: React.MutableRefObject<{ zoomBy(f: number): void; reset(): void; fit(): void; zoom: number } | null>;
  onZoom(z: number): void;
  left: React.ReactNode;
  right: React.ReactNode;
  overlay: React.ReactNode;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const HOME_PAN = { x: 96, y: 12 };

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** Droppables win in this order: tray, board cards, columns, then the open canvas. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args).filter((h) => {
    const id = String(h.id);
    const self = String(args.active.id);
    return id !== `column:${self}` && id !== `board:${self}`;
  });
  const rank = (id: string) => (id === "tray" ? 0 : id.startsWith("board:") ? 1 : id.startsWith("column:") ? 2 : 3);
  return hits.sort((a, b) => rank(String(a.id)) - rank(String(b.id)));
};

export function BoardCanvas({ store, unsorted, onPlacedFromTray, onReturnedToTray, arrowMode, setArrowMode, createRef, zoomRef, onZoom, left, right, overlay }: Props) {
  const toast = useToast();
  const router = useRouter();
  const { items, references, childBoards, commit, boardId } = store;
  const viewport = useRef<HTMLDivElement>(null);
  // Start clear of the floating menu bar on the left.
  const [pan, setPan] = useState(HOME_PAN);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drag, setDrag] = useState<null | { id: string; type: string; dx: number; dy: number; start: { x: number; y: number } }>(null);
  const heights = useRef(new Map<string, number>());
  const [layoutTick, setLayoutTick] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const list = useMemo(() => [...items.values()], [items]);
  const loose = useMemo(() => list.filter((i) => !i.columnId && i.kind !== "arrow").sort((a, b) => a.z - b.z), [list]);
  const arrows = useMemo(() => list.filter((i) => i.kind === "arrow"), [list]);
  const childrenOf = useCallback(
    (col: string) => list.filter((i) => i.columnId === col).sort((a, b) => a.position - b.position),
    [list],
  );

  useEffect(() => onZoom(zoom), [zoom, onZoom]);

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = viewport.current!.getBoundingClientRect();
      return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom };
    },
    [pan, zoom],
  );
  const viewCenter = useCallback(() => {
    const r = viewport.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 3);
  }, [toWorld]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const r = viewport.current!.getBoundingClientRect();
      const px = (cx ?? r.left + r.width / 2) - r.left;
      const py = (cy ?? r.top + r.height / 2) - r.top;
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
        setPan((p) => ({ x: px - ((px - p.x) * next) / z, y: py - ((py - p.y) * next) / z }));
        return next;
      });
    },
    [],
  );
  useEffect(() => {
    zoomRef.current = {
      zoomBy: (f) => zoomAt(f),
      reset: () => {
        setZoom(1);
        setPan(HOME_PAN);
      },
      // Fit everything on the board into view (with room for the floating toolbars).
      fit: () => {
        const el = viewport.current;
        const cards = [...items.values()].filter((i) => !i.columnId && i.kind !== "arrow");
        if (!el || !cards.length) return;
        const x0 = Math.min(...cards.map((i) => i.x));
        const y0 = Math.min(...cards.map((i) => i.y));
        const x1 = Math.max(...cards.map((i) => i.x + i.w));
        const y1 = Math.max(...cards.map((i) => i.y + (heights.current.get(i.id) ?? 200)));
        const r = el.getBoundingClientRect();
        const padL = 110;
        const pad = 48;
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((r.width - padL - pad) / (x1 - x0), (r.height - pad * 2) / (y1 - y0), 1.25)));
        setZoom(z);
        setPan({ x: padL + (r.width - padL - pad - (x1 - x0) * z) / 2 - x0 * z, y: pad + (r.height - pad * 2 - (y1 - y0) * z) / 2 - y0 * z });
      },
      zoom,
    };
  }, [zoom, zoomAt, zoomRef, items]);

  // Wheel pans; Ctrl/Cmd + wheel (and trackpad pinch) zooms at the pointer.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /** Save pending edits first, so the board we open already has the cards just dropped on it. */
  const openBoard = useCallback(
    async (bid: string) => {
      await store.flush();
      router.push(`/boards/${bid}`);
    },
    [router, store],
  );

  /* ---------- creating ---------- */

  const nextZ = useCallback(() => Math.max(0, ...[...items.values()].map((i) => i.z)) + 1, [items]);

  const create = useCallback(
    async (tool: Tool, at?: { x: number; y: number }, columnId?: string | null, position?: number) => {
      if (editing) (document.activeElement as HTMLElement | null)?.blur();
      let p = at ?? viewCenter();
      // Clicked (not dropped) cards cascade so they don't land exactly on top of each other.
      if (!at) {
        const w0 = tool === "column" ? COLUMN_WIDTH : DEFAULT_CARD_WIDTH;
        for (let n = 0; n < 40; n++) {
          const x = Math.round(p.x - w0 / 2);
          const y = Math.round(p.y - 30);
          if (![...items.values()].some((i) => !i.columnId && Math.abs(i.x - x) < 24 && Math.abs(i.y - y) < 24)) break;
          p = { x: p.x + 32, y: p.y + 32 };
        }
      }
      const id = crypto.randomUUID();
      const base: NewBoardItem = {
        id,
        kind: tool === "swatch" ? "note" : tool,
        x: Math.round(p.x - (tool === "column" ? COLUMN_WIDTH : tool === "swatch" ? 140 : DEFAULT_CARD_WIDTH) / 2),
        y: Math.round(p.y - 30),
        w: tool === "column" ? COLUMN_WIDTH : tool === "board" ? 200 : tool === "swatch" ? 140 : DEFAULT_CARD_WIDTH,
        z: nextZ(),
        position: position ?? 0,
        columnId: columnId ?? null,
        content: tool === "note" ? { text: "" } : tool === "swatch" ? { swatch: "#2a64d8" } : tool === "column" ? { title: "Untitled column" } : {},
      };
      if (tool === "board") {
        const res = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Untitled board", parentBoardId: boardId, placeCard: false }) });
        if (!res.ok) return toast("Couldn't create the board.", "error");
        const { board } = (await res.json()) as { board: { id: string; title: string } };
        base.childBoardId = board.id;
        store.setChildBoards((c) => ({ ...c, [board.id]: { id: board.id, title: board.title, cover: [], count: 0 } }));
      }
      // Board cards own a board; deleting them isn't undoable, so creating one isn't either.
      commit({ create: [base] }, tool === "board" ? null : { delete: [id] }, `Add ${tool}`);
      setSelected(new Set([id]));
      if (tool === "note" || tool === "link") setEditing(id);
      if (tool === "column") setEditing(id);
    },
    [boardId, commit, editing, items, nextZ, store, toast, viewCenter],
  );
  useEffect(() => {
    createRef.current = (tool, at) => void create(tool, at);
  }, [create, createRef]);

  /* ---------- deleting / duplicating / nudging ---------- */

  const deleteSelected = useCallback(() => {
    const ids = [...selected].filter((id) => items.has(id));
    if (!ids.length) return;
    const doomed = ids.map((id) => items.get(id)!);
    const boardCards = doomed.filter((i) => i.kind === "board");
    if (boardCards.length && !window.confirm(`Delete ${boardCards.length === 1 ? "this board and everything on it" : `${boardCards.length} boards and everything on them`}? This can't be undone.`))
      return;
    // Undo recreates the items, the cards that were in deleted columns, and attached arrows.
    const idSet = new Set(ids);
    const attachedArrows = [...items.values()].filter((a) => a.kind === "arrow" && !idSet.has(a.id) && (idSet.has(a.content.from ?? "") || idSet.has(a.content.to ?? "")));
    const releasedKids = [...items.values()].filter((i) => i.columnId && idSet.has(i.columnId) && !idSet.has(i.id));
    const undoable = !boardCards.length;
    commit(
      { delete: ids },
      undoable
        ? {
            create: [...doomed, ...attachedArrows].map(itemToNew),
            update: releasedKids.map((k) => ({ id: k.id, columnId: k.columnId, x: k.x, y: k.y, z: k.z, position: k.position })),
          }
        : null,
      "Delete",
    );
    const backToTray = doomed.filter((i) => i.kind === "reference" && i.referenceId && references[i.referenceId]).map((i) => references[i.referenceId!]!);
    if (backToTray.length) onReturnedToTray(backToTray);
    setSelected(new Set());
  }, [commit, items, onReturnedToTray, references, selected]);

  const duplicateSelected = useCallback(() => {
    const src = [...selected].map((id) => items.get(id)).filter((i): i is Item => Boolean(i) && i!.kind !== "board" && i!.kind !== "arrow");
    if (!src.length) return;
    let z = nextZ();
    const copies = src.map((i) => ({ ...itemToNew(i), id: crypto.randomUUID(), x: i.x + 24, y: i.y + 24, z: z++, position: i.position + 0.5 }));
    commit({ create: copies }, { delete: copies.map((c) => c.id) }, "Duplicate");
    setSelected(new Set(copies.map((c) => c.id)));
  }, [commit, items, nextZ, selected]);

  const moveSelectedBy = useCallback(
    (dx: number, dy: number) => {
      const ids = [...selected].filter((id) => items.get(id) && !items.get(id)!.columnId);
      if (!ids.length) return;
      const updates: BoardItemPatch[] = ids.map((id) => ({ id, x: items.get(id)!.x + dx, y: items.get(id)!.y + dy }));
      commit({ update: updates }, { update: inverseUpdates(items, updates, boardId) }, "Move");
    },
    [boardId, commit, items, selected],
  );

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) setSpaceHeld(true);
      if (isTyping(e.target) || editing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const label = e.shiftKey ? store.redo() : store.undo();
        if (label) toast(`${e.shiftKey ? "Redid" : "Undid"}: ${label}`);
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const label = store.redo();
        if (label) toast(`Redid: ${label}`);
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(loose.map((i) => i.id)));
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setArrowMode(false);
        setArrowFrom(null);
      } else if (e.key.startsWith("Arrow") && selected.size) {
        e.preventDefault();
        const step = e.shiftKey ? 40 : 8;
        moveSelectedBy(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      } else if (e.key === "Enter" && selected.size === 1) {
        const it = items.get([...selected][0]!);
        if (!it) return;
        e.preventDefault();
        if (it.kind === "board" && it.childBoardId) void openBoard(it.childBoardId);
        else if (it.kind === "note" || it.kind === "link" || it.kind === "column") setEditing(it.id);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void create("note");
      } else if (e.key === "=" || e.key === "+") zoomAt(1.2);
      else if (e.key === "-") zoomAt(1 / 1.2);
      else if (e.key === "0") {
        setZoom(1);
        setPan(HOME_PAN);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [create, deleteSelected, duplicateSelected, editing, items, loose, moveSelectedBy, openBoard, selected, setArrowMode, store, toast, zoomAt]);

  /* ---------- selection, panning, marquee ---------- */

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, pan };
      const move = (ev: PointerEvent) => setPan({ x: start.pan.x + ev.clientX - start.x, y: start.pan.y + ev.clientY - start.y });
      const upFn = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", upFn);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", upFn);
      return;
    }
    if (e.button !== 0) return;
    if (!e.shiftKey && !e.metaKey) setSelected(new Set());
    // Blur first: an editor unmounted by setEditing(null) never fires onBlur, which saves it.
    if (editing) (document.activeElement as HTMLElement | null)?.blur();
    setEditing(null);
    const r = viewport.current!.getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const y0 = e.clientY - r.top;
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    const additive = e.shiftKey || e.metaKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const move = (ev: PointerEvent) => {
      const m = { x0, y0, x1: ev.clientX - r.left, y1: ev.clientY - r.top };
      setMarquee(m);
      const a = { x: (Math.min(m.x0, m.x1) - pan.x) / zoom, y: (Math.min(m.y0, m.y1) - pan.y) / zoom };
      const b = { x: (Math.max(m.x0, m.x1) - pan.x) / zoom, y: (Math.max(m.y0, m.y1) - pan.y) / zoom };
      const hit = new Set(base);
      for (const it of loose) {
        const h = heights.current.get(it.id) ?? 120;
        if (it.x < b.x && it.x + it.w > a.x && it.y < b.y && it.y + h > a.y) hit.add(it.id);
      }
      setSelected(hit);
    };
    const upFn = () => {
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", upFn);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", upFn);
  };

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (spaceHeld || e.button !== 0) return;
      e.stopPropagation();
      if (arrowMode) {
        if (!arrowFrom) {
          setArrowFrom(id);
          toast("Now click the card the arrow points to.");
        } else if (arrowFrom !== id) {
          const aid = crypto.randomUUID();
          commit({ create: [{ id: aid, kind: "arrow", x: 0, y: 0, w: 80, z: 0, position: 0, columnId: null, content: { from: arrowFrom, to: id } }] }, { delete: [aid] }, "Add arrow");
          setArrowFrom(null);
          setArrowMode(false);
        }
        return;
      }
      setSelected((cur) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return cur.has(id) ? cur : new Set([id]);
      });
    },
    [arrowFrom, arrowMode, commit, setArrowMode, spaceHeld, toast],
  );

  const bumpChildCount = (child: string, by: number, thumb?: string | null) =>
    store.setChildBoards((c) =>
      c[child]
        ? { ...c, [child]: { ...c[child], count: c[child].count + by, cover: thumb && c[child].cover.length < 4 ? [...c[child].cover, thumb] : c[child].cover } }
        : c,
    );

  /* ---------- drag and drop ---------- */

  const onDragStart = (e: DragStartEvent) => {
    const ev = e.activatorEvent as PointerEvent;
    const type = String(e.active.data.current?.type ?? "item");
    setDrag({ id: String(e.active.id), type, dx: 0, dy: 0, start: { x: ev.clientX, y: ev.clientY } });
    if (type === "item" && !selected.has(String(e.active.id))) setSelected(new Set([String(e.active.id)]));
  };
  const onDragMove = (e: DragMoveEvent) => setDrag((d) => (d ? { ...d, dx: e.delta.x, dy: e.delta.y } : d));
  const onDragCancel = () => setDrag(null);

  /** Order key for dropping at pointer Y inside a column (ignores the items being moved). */
  const columnSlot = (colId: string, clientY: number, moving: Set<string>) => {
    const kids = childrenOf(colId).filter((k) => !moving.has(k.id));
    const els = kids.map((k) => document.querySelector(`[data-item-id="${k.id}"]`)?.getBoundingClientRect());
    let idx = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = els[i];
      if (r && clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return { before: kids[idx - 1]?.position ?? null, after: kids[idx]?.position ?? null };
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const over = e.over ? String(e.over.id) : null;
    const pointer = { x: d.start.x + e.delta.x, y: d.start.y + e.delta.y };
    const world = toWorld(pointer.x, pointer.y);
    const data = e.active.data.current as { type: string; tool?: Tool; ref?: RefLite } | undefined;

    // From the toolbar.
    if (data?.type === "tool" && data.tool) {
      if (over?.startsWith("column:") && data.tool !== "column") {
        const col = over.slice(7);
        const slot = columnSlot(col, pointer.y, new Set());
        await create(data.tool, world, col, positionBetween(slot.before, slot.after));
      } else if (over === "canvas" || over?.startsWith("column:")) await create(data.tool, world);
      return;
    }

    // From the Unsorted tray.
    if (data?.type === "tray" && data.ref) {
      const ref = data.ref;
      const id = crypto.randomUUID();
      const w = aspectOf(ref) < 0.9 ? 200 : 280;
      if (over?.startsWith("board:")) {
        const target = items.get(over.slice(6));
        if (!target?.childBoardId) return;
        const res = await fetch(`/api/boards/${target.childBoardId}/ops`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ create: [{ id, kind: "reference", referenceId: ref.id, x: 40, y: 40, w, z: 1 }] }),
        });
        if (!res.ok) return toast("Couldn't move it to that board.", "error");
        onPlacedFromTray([ref.id]);
        bumpChildCount(target.childBoardId, 1, ref.thumbnailUrl);
        toast(`Moved to ${childBoards[target.childBoardId]?.title ?? "board"}`, "success");
        return;
      }
      if (over !== "canvas" && !over?.startsWith("column:")) return;
      store.setReferences((r) => ({ ...r, [ref.id]: ref }));
      const col = over?.startsWith("column:") ? over.slice(7) : null;
      const slot = col ? columnSlot(col, pointer.y, new Set()) : null;
      commit(
        {
          create: [
            {
              id,
              kind: "reference",
              referenceId: ref.id,
              x: Math.round(world.x - w / 2),
              y: Math.round(world.y - 30),
              w,
              z: nextZ(),
              columnId: col,
              position: slot ? positionBetween(slot.before, slot.after) : 0,
              content: {},
            },
          ],
        },
        { delete: [id] },
        "Add from Unsorted",
      );
      onPlacedFromTray([ref.id]);
      setSelected(new Set([id]));
      return;
    }

    // Moving existing items.
    const active = items.get(d.id);
    if (!active) return;
    const moving = selected.has(d.id) ? [...selected].map((id) => items.get(id)).filter((i): i is Item => Boolean(i)) : [active];
    const movingIds = new Set(moving.map((m) => m.id));
    if (!over) return;

    if (over === "tray") {
      const refs = moving.filter((m) => m.kind === "reference");
      if (!refs.length) return;
      commit({ delete: refs.map((r) => r.id) }, { create: refs.map(itemToNew) }, "Move to Unsorted");
      onReturnedToTray(refs.map((r) => references[r.referenceId!]).filter((r): r is RefLite => Boolean(r)));
      setSelected(new Set());
      return;
    }
    if (over.startsWith("board:")) {
      const target = items.get(over.slice(6));
      if (!target?.childBoardId || movingIds.has(target.id)) return;
      const updates: BoardItemPatch[] = moving.map((m, i) => ({ id: m.id, boardId: target.childBoardId!, columnId: null, x: 40 + i * 24, y: 40 + i * 24 }));
      commit({ update: updates }, { update: inverseUpdates(items, updates, boardId) }, "Move to board");
      bumpChildCount(target.childBoardId, moving.length);
      toast(`Moved ${moving.length} ${moving.length === 1 ? "card" : "cards"} to ${childBoards[target.childBoardId]?.title ?? "board"}`, "success");
      setSelected(new Set());
      return;
    }
    if (over.startsWith("column:")) {
      const col = over.slice(7);
      const movable = moving.filter((m) => m.kind !== "column" && m.kind !== "arrow");
      if (!movable.length) return;
      const slot = columnSlot(col, pointer.y, movingIds);
      let lo = slot.before;
      const updates: BoardItemPatch[] = movable.map((m) => {
        const pos = positionBetween(lo, slot.after);
        lo = pos;
        return { id: m.id, columnId: col, position: pos };
      });
      commit({ update: updates }, { update: inverseUpdates(items, updates, boardId) }, "Move into column");
      return;
    }
    if (over === "canvas") {
      const dx = e.delta.x / zoom;
      const dy = e.delta.y / zoom;
      let z = nextZ();
      const updates: BoardItemPatch[] = moving.map((m) =>
        m.columnId
          ? { id: m.id, columnId: null, x: Math.round(world.x - m.w / 2), y: Math.round(world.y - 20), z: z++ }
          : { id: m.id, x: Math.round(m.x + dx), y: Math.round(m.y + dy), z: z++ },
      );
      commit({ update: updates }, { update: inverseUpdates(items, updates, boardId) }, "Move");
    }
  };

  const dragOffsetFor = (it: Item) => {
    if (!drag || drag.type !== "item" || it.columnId) return null;
    const moving = selected.has(drag.id) ? selected.has(it.id) : drag.id === it.id;
    return moving ? { x: drag.dx / zoom, y: drag.dy / zoom } : null;
  };

  const resize = (id: string, w: number, commitIt: boolean, from?: number) => {
    const it = items.get(id);
    if (!it) return;
    if (commitIt) commit({ update: [{ id, w }] }, { update: [{ id, w: from ?? it.w }] }, "Resize");
    else store.commit({ update: [{ id, w }] }, null, "Resize");
  };

  const finishEdit = (id: string, patch: Partial<Item["content"]> | null) => {
    setEditing(null);
    const it = items.get(id);
    if (!it || !patch) {
      if (it?.kind === "link" && !it.content.url) commit({ delete: [id] }, null, "Remove empty link");
      return;
    }
    const content = { ...it.content, ...patch };
    if (JSON.stringify(content) === JSON.stringify(it.content)) return;
    commit({ update: [{ id, content }] }, { update: [{ id, content: it.content }] }, "Edit");
  };

  const activeTray = drag?.type === "tray" ? unsorted.find((r) => `tray:${r.id}` === drag.id) : null;
  const activeColumnChild = drag?.type === "item" ? items.get(drag.id) : null;

  return (
    <DndContext id="board-dnd" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={onDragCancel}>
      {left}
      <div className="relative min-w-0 flex-1">
      <CanvasDroppable
        viewportRef={viewport}
        onPointerDown={onBackgroundDown}
        cursor={spaceHeld ? "grab" : arrowMode ? "crosshair" : "default"}
        pan={pan}
        zoom={zoom}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} data-testid="board-world">
          <Arrows arrows={arrows} pan={pan} zoom={zoom} viewport={viewport} tick={layoutTick} selected={selected} onSelect={(id) => setSelected(new Set([id]))} itemsVersion={items} />
          {loose.map((it) => (
            <CanvasItem
              key={it.id}
              item={it}
              store={store}
              selected={selected.has(it.id)}
              arrowSource={arrowFrom === it.id}
              editing={editing === it.id}
              offset={dragOffsetFor(it)}
              hidden={false}
              childrenOf={childrenOf}
              selectedSet={selected}
              editingId={editing}
              draggingId={drag?.type === "item" ? drag.id : null}
              onPointerDown={onItemPointerDown}
              onEdit={setEditing}
              onFinishEdit={finishEdit}
              onResize={resize}
              onOpenBoard={openBoard}
              onHeight={(id, h) => {
                if (heights.current.get(id) !== h) {
                  heights.current.set(id, h);
                  setLayoutTick((t) => t + 1);
                }
              }}
            />
          ))}
        </div>
        {marquee && (
          <div
            className="pointer-events-none absolute rounded-xs border border-accent bg-accent-soft"
            style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
          />
        )}
        {list.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="text-lg">An empty board</p>
              <p className="mt-1 text-sm text-text-muted">Drag a card from the left, or something from Unsorted. Press N for a note.</p>
            </div>
          </div>
        )}
      </CanvasDroppable>
      {overlay}
      </div>
      {right}
      <DragOverlay dropAnimation={null}>
        {activeTray ? (
          <div className="w-[200px] overflow-hidden rounded-md border border-border bg-surface shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <ReferenceBody reference={activeTray} hovering={false} />
          </div>
        ) : drag?.type === "tool" ? (
          <div className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.18)]">New {drag.id.slice(5)}</div>
        ) : activeColumnChild?.columnId ? (
          <div style={{ width: COLUMN_WIDTH - 16, transform: `scale(${zoom})`, transformOrigin: "top left" }} className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <ItemBody item={activeColumnChild} store={store} editing={false} hovering={false} onFinishEdit={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function CanvasDroppable({
  viewportRef,
  children,
  onPointerDown,
  cursor,
  pan,
  zoom,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  onPointerDown(e: React.PointerEvent): void;
  cursor: string;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const { setNodeRef } = useDroppable({ id: "canvas" });
  // Must be stable: an inline ref callback is detached (set to null) on every render and only
  // re-attached after children's layout effects, which is exactly when Arrows measures.
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      viewportRef.current = el;
    },
    [setNodeRef, viewportRef],
  );
  return (
    <div
      ref={attach}
      onPointerDown={onPointerDown}
      className="relative h-full w-full overflow-hidden select-none"
      // A faint dot grid that moves with the board (Milanote-style).
      style={{
        cursor,
        backgroundImage: "radial-gradient(var(--in-border-strong) 0.9px, transparent 0.9px)",
        backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      data-testid="board-canvas"
      role="application"
      aria-label="Board canvas. Arrow keys move the selection, N adds a note, Delete removes."
    >
      {children}
    </div>
  );
}

interface ItemProps {
  item: Item;
  store: BoardStore;
  selected: boolean;
  arrowSource: boolean;
  editing: boolean;
  offset: { x: number; y: number } | null;
  hidden: boolean;
  childrenOf(col: string): Item[];
  selectedSet: Set<string>;
  editingId: string | null;
  draggingId: string | null;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onEdit(id: string): void;
  onFinishEdit(id: string, patch: Partial<Item["content"]> | null): void;
  onResize(id: string, w: number, commit: boolean, from?: number): void;
  onOpenBoard(id: string): void;
  onHeight(id: string, h: number): void;
}

function ItemBody({
  item,
  store,
  editing,
  hovering,
  onFinishEdit,
}: {
  item: Item;
  store: BoardStore;
  editing: boolean;
  hovering: boolean;
  onFinishEdit(id: string, patch: Partial<Item["content"]> | null): void;
}) {
  if (item.kind === "reference") {
    const ref = item.referenceId ? store.references[item.referenceId] : undefined;
    return <ReferenceBody reference={ref} hovering={hovering} clean boardId={store.boardId} />;
  }
  if (item.kind === "note" && item.content.swatch)
    return <SwatchBody hex={item.content.swatch} editing={editing} onDone={(hex) => onFinishEdit(item.id, hex === null ? null : { swatch: hex })} />;
  if (item.kind === "note")
    return <NoteBody text={item.content.text ?? ""} color={item.content.color} editing={editing} onDone={(t) => onFinishEdit(item.id, t === null ? null : { text: t })} />;
  if (item.kind === "link")
    return (
      <LinkBody
        url={item.content.url}
        title={item.content.title}
        host={item.content.host}
        editing={editing}
        onDone={(u) => {
          if (u === null) return onFinishEdit(item.id, null);
          const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
          onFinishEdit(item.id, { url, host: hostOf(url), title: item.content.title ?? hostOf(url) });
        }}
      />
    );
  if (item.kind === "board") {
    const b = item.childBoardId ? store.childBoards[item.childBoardId] : undefined;
    return <BoardBody title={b?.title ?? "Board"} cover={b?.cover ?? []} count={b?.count ?? 0} />;
  }
  return null;
}

const CanvasItem = memo(function CanvasItem(p: ItemProps) {
  const { item } = p;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { type: "item" }, disabled: p.editing });
  const boardDrop = useDroppable({ id: `board:${item.id}`, disabled: item.kind !== "board" });
  const columnDrop = useDroppable({ id: `column:${item.id}`, disabled: item.kind !== "column" });
  const feedback = useFeedbackCounts();
  const [hovering, setHovering] = useState(false);
  const el = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => el.current && p.onHeight(item.id, el.current.offsetHeight));
    ro.observe(el.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const style: React.CSSProperties = item.columnId
    ? { opacity: p.draggingId === item.id ? 0.35 : 1 }
    : {
        position: "absolute",
        left: item.x,
        top: item.y,
        width: item.kind === "column" ? COLUMN_WIDTH : item.w,
        zIndex: isDragging || p.offset ? 10_000 : item.z,
        transform: p.offset ? `translate(${p.offset.x}px, ${p.offset.y}px)` : undefined,
      };

  const ring = p.arrowSource ? "outline outline-2 outline-offset-2 outline-accent outline-dashed" : p.selected ? "outline outline-2 outline-offset-1 outline-accent" : "";

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = item.w;
    const world = el.current?.closest("[data-testid=board-world]") as HTMLElement | null;
    const scale = world ? world.getBoundingClientRect().width / world.offsetWidth || 1 : 1;
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(960, Math.max(140, startW + (ev.clientX - startX) / scale)));
      p.onResize(item.id, last, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      p.onResize(item.id, last, true, startW);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (item.kind === "column") {
    const kids = p.childrenOf(item.id);
    return (
      <div
        ref={(n) => {
          setNodeRef(n);
          columnDrop.setNodeRef(n);
          el.current = n;
        }}
        style={style}
        data-item-id={item.id}
        data-kind="column"
        className={`rounded-md bg-surface-4 p-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)] ${columnDrop.isOver ? "outline-2 outline-accent outline-solid" : ""} ${ring}`}
        onPointerDown={(e) => p.onPointerDown(e, item.id)}
      >
        <div {...listeners} {...attributes} tabIndex={0} aria-label={`Column ${item.content.title ?? ""}`} className="flex cursor-grab items-center justify-between px-1.5 pt-1 pb-2.5">
          {p.editing ? (
            <ColumnTitleEditor title={item.content.title ?? ""} onDone={(t) => p.onFinishEdit(item.id, t === null ? null : { title: t || "Untitled column" })} />
          ) : (
            <span className="truncate text-md font-semibold" onDoubleClick={() => p.onEdit(item.id)} data-testid="column-title">
              {item.content.title || "Untitled column"}
            </span>
          )}
          <span className="text-xs text-text-faint tabular">{kids.length} {kids.length === 1 ? "card" : "cards"}</span>
        </div>
        <div className="flex min-h-[56px] flex-col gap-2" data-column-body={item.id}>
          {kids.map((k) => (
            <ColumnChild key={k.id} {...p} item={k} selected={p.selectedSet.has(k.id)} editing={p.editingId === k.id} offset={null} />
          ))}
          {kids.length === 0 && <div className="grid h-16 place-items-center rounded-sm border border-dashed border-border-strong text-xs text-text-faint">Drag cards here</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        boardDrop.setNodeRef(n);
        el.current = n;
      }}
      style={style}
      data-item-id={item.id}
      data-kind={item.kind}
      {...listeners}
      {...attributes}
      tabIndex={0}
      aria-label={item.kind === "reference" ? (p.store.references[item.referenceId ?? ""]?.title ?? "Reference") : item.kind}
      onPointerDown={(e) => {
        listeners?.onPointerDown?.(e);
        p.onPointerDown(e, item.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (item.kind === "board" && item.childBoardId) p.onOpenBoard(item.childBoardId);
        else if (item.kind === "note" || item.kind === "link") p.onEdit(item.id);
        else if (item.kind === "reference" && item.referenceId) feedback?.open(item.referenceId);
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      className={`group overflow-visible rounded-[3px] ${
        item.kind === "board" ? "hover:bg-surface/70" : "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.05)]"
      } ${boardDrop.isOver ? "outline-2 outline-accent outline-solid" : ""} ${ring}`}
    >
      {p.selected && p.selectedSet.size === 1 && item.kind === "note" && !item.content.swatch && !p.editing && (
        <div
          className="absolute -top-11 left-0 z-10 flex items-center gap-1 rounded-md bg-surface p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
          role="toolbar"
          aria-label="Note colour"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`${c} note`}
              aria-pressed={(item.content.color ?? "white") === c}
              onClick={() => p.onFinishEdit(item.id, { color: c })}
              className={`h-5 w-5 rounded-full border border-black/15 ${NOTE_SWATCH_CLASS[c]} ${(item.content.color ?? "white") === c ? "ring-2 ring-accent ring-offset-1" : ""}`}
            />
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-[3px]">
        <ItemBody item={item} store={p.store} editing={p.editing} hovering={hovering} onFinishEdit={p.onFinishEdit} />
      </div>
      {p.selected && !item.columnId && (
        <span
          role="presentation"
          onPointerDown={startResize}
          className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-xs border-2 border-accent bg-surface"
          title="Drag to resize"
          data-testid="resize-handle"
        />
      )}
    </div>
  );
});

function ColumnChild(p: ItemProps) {
  const { item } = p;
  const { attributes, listeners, setNodeRef } = useDraggable({ id: item.id, data: { type: "item" }, disabled: p.editing });
  const boardDrop = useDroppable({ id: `board:${item.id}`, disabled: item.kind !== "board" });
  const [hovering, setHovering] = useState(false);
  const ring = p.selected ? "outline outline-2 outline-offset-1 outline-accent" : "";
  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        boardDrop.setNodeRef(n);
      }}
      data-item-id={item.id}
      data-kind={item.kind}
      {...listeners}
      {...attributes}
      tabIndex={0}
      style={{ opacity: p.draggingId === item.id ? 0.35 : 1 }}
      onPointerDown={(e) => {
        listeners?.onPointerDown?.(e);
        p.onPointerDown(e, item.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (item.kind === "board" && item.childBoardId) p.onOpenBoard(item.childBoardId);
        else if (item.kind === "note" || item.kind === "link") p.onEdit(item.id);
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`overflow-hidden rounded-[3px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.12)] ${boardDrop.isOver ? "outline-2 outline-accent outline-solid" : ""} ${ring}`}
    >
      <ItemBody item={item} store={p.store} editing={p.editing} hovering={hovering} onFinishEdit={p.onFinishEdit} />
    </div>
  );
}

function ColumnTitleEditor({ title, onDone }: { title: string; onDone(t: string | null): void }) {
  const [v, setV] = useState(title);
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v.trim());
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(v.trim())}
      onFocus={(e) => e.currentTarget.select()}
      aria-label="Column title"
      className="h-6 min-w-0 flex-1 rounded-xs border border-border-strong bg-surface px-1.5 text-sm font-semibold focus:border-accent focus:outline-none"
    />
  );
}

/** Arrows are drawn between the cards' current on-screen boxes, converted to world space. */
function Arrows({
  arrows,
  pan,
  zoom,
  viewport,
  tick,
  selected,
  onSelect,
  itemsVersion,
}: {
  arrows: Item[];
  pan: { x: number; y: number };
  zoom: number;
  viewport: React.RefObject<HTMLDivElement | null>;
  tick: number;
  selected: Set<string>;
  onSelect(id: string): void;
  itemsVersion: unknown;
}) {
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);
  useLayoutEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const v = vp.getBoundingClientRect();
    const box = (id: string) => {
      const r = document.querySelector(`[data-item-id="${id}"]`)?.getBoundingClientRect();
      if (!r) return null;
      return { x: (r.left - v.left - pan.x) / zoom, y: (r.top - v.top - pan.y) / zoom, w: r.width / zoom, h: r.height / zoom };
    };
    const edge = (b: { x: number; y: number; w: number; h: number }, toward: { x: number; y: number }) => {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const dx = toward.x - cx;
      const dy = toward.y - cy;
      const s = Math.min(Math.abs(b.w / 2 / (dx || 1e-6)), Math.abs(b.h / 2 / (dy || 1e-6)));
      return { x: cx + dx * s, y: cy + dy * s };
    };
    const next = arrows.flatMap((a) => {
      const A = box(a.content.from ?? "");
      const B = box(a.content.to ?? "");
      if (!A || !B) return [];
      const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 };
      const cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
      const p0 = edge(A, cb);
      const p1 = edge(B, ca);
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const bend = 0.15;
      const c = { x: mx - (p1.y - p0.y) * bend, y: my + (p1.x - p0.x) * bend };
      return [{ id: a.id, d: `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}` }];
    });
    // Arrow endpoints come from measured DOM boxes, so this has to run after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPaths((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, [arrows, pan, zoom, viewport, tick, itemsVersion]);
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" style={{ zIndex: 5000 }} aria-hidden="true">
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--in-text-muted)" />
        </marker>
        <marker id="arrowhead-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--in-accent)" />
        </marker>
      </defs>
      {paths.map((p) => (
        <g key={p.id} data-arrow-id={p.id}>
          <path d={p.d} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-[stroke] cursor-pointer" style={{ pointerEvents: "stroke" }} onPointerDown={(e) => { e.stopPropagation(); onSelect(p.id); }} />
          <path
            d={p.d}
            fill="none"
            stroke={selected.has(p.id) ? "var(--in-accent)" : "var(--in-text-muted)"}
            strokeWidth={1.6}
            markerEnd={`url(#${selected.has(p.id) ? "arrowhead-sel" : "arrowhead"})`}
          />
        </g>
      ))}
    </svg>
  );
}
