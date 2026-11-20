"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardItemPatch, BoardOps, NewBoardItem } from "@innovate/shared";
import type { BoardData, BoardItemDTO } from "@/lib/boards";

export type Item = BoardItemDTO;

interface Change {
  forward: BoardOps;
  backward: BoardOps;
  label: string;
}

const empty = (): BoardOps => ({ create: [], update: [], delete: [] });

/** Apply ops to local state, mirroring lib/boards.ts applyOps (column release, arrow cleanup). */
function applyLocal(items: Map<string, Item>, ops: BoardOps, boardId: string): Map<string, Item> {
  const next = new Map(items);
  for (const c of ops.create)
    next.set(c.id, {
      id: c.id,
      kind: c.kind,
      referenceId: c.referenceId ?? null,
      childBoardId: c.childBoardId ?? null,
      columnId: c.columnId ?? null,
      x: c.x,
      y: c.y,
      w: c.w,
      z: c.z,
      position: c.position,
      content: c.content,
    });
  for (const u of ops.update) {
    const cur = next.get(u.id);
    if (!cur) continue;
    if (u.boardId && u.boardId !== boardId) {
      next.delete(u.id);
      for (const [id, it] of next) if (it.columnId === u.id) next.delete(id);
      continue;
    }
    const { boardId: _b, ...rest } = u;
    next.set(u.id, { ...cur, ...rest, content: rest.content ?? cur.content });
  }
  for (const id of ops.delete) {
    const cur = next.get(id);
    next.delete(id);
    if (cur?.kind === "column") {
      let n = 0;
      for (const [cid, it] of next)
        if (it.columnId === id) next.set(cid, { ...it, columnId: null, x: cur.x + 12, y: cur.y + 40 + n * 24, z: cur.z + 1 + n++ });
    }
  }
  const gone = new Set([...ops.delete, ...ops.update.filter((u) => u.boardId && u.boardId !== boardId).map((u) => u.id)]);
  for (const [id, it] of next) if (it.kind === "arrow" && (gone.has(it.content.from ?? "") || gone.has(it.content.to ?? ""))) next.delete(id);
  return next;
}

/** The inverse of a set of updates, computed from current state. */
export function inverseUpdates(items: Map<string, Item>, updates: BoardItemPatch[], boardId: string): BoardItemPatch[] {
  return updates.flatMap((u) => {
    const cur = items.get(u.id);
    if (!cur) return [];
    const back: BoardItemPatch = { id: u.id };
    if (u.boardId !== undefined) back.boardId = boardId;
    for (const k of ["columnId", "x", "y", "w", "z", "position", "content"] as const) if (u[k] !== undefined) (back as Record<string, unknown>)[k] = cur[k];
    return [back];
  });
}

export function itemToNew(it: Item): NewBoardItem {
  return {
    id: it.id,
    kind: it.kind,
    referenceId: it.referenceId,
    childBoardId: it.childBoardId,
    columnId: it.columnId,
    x: it.x,
    y: it.y,
    w: it.w,
    z: it.z,
    position: it.position,
    content: it.content,
  };
}

export function useBoard(initial: BoardData, onError: (msg: string) => void) {
  const boardId = initial.board.id;
  const [items, setItems] = useState(() => new Map(initial.items.map((i) => [i.id, i])));
  const [references, setReferences] = useState(initial.references);
  const [childBoards, setChildBoards] = useState(initial.childBoards);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const pending = useRef<BoardOps[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<Change[]>([]);
  const redoStack = useRef<Change[]>([]);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const bump = useCallback(() => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length }), []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch = pending.current.splice(0);
    if (!batch.length) return;
    // Group consecutive ops per target board (moves to other boards are plain updates here).
    const merged = batch.reduce<BoardOps>(
      (acc, o) => ({ create: [...acc.create, ...o.create], update: [...acc.update, ...o.update], delete: [...acc.delete, ...o.delete] }),
      empty(),
    );
    setSaving("saving");
    try {
      const res = await fetch(`/api/boards/${boardId}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(merged) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the board.");
      setSaving(pending.current.length ? "saving" : "idle");
    } catch (err) {
      setSaving("error");
      onError((err as Error).message);
    }
  }, [boardId, onError]);

  const enqueue = useCallback(
    (ops: BoardOps) => {
      pending.current.push(ops);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 250);
    },
    [flush],
  );

  // Save before leaving the page.
  useEffect(() => {
    const onHide = () => {
      if (!pending.current.length) return;
      const merged = pending.current.splice(0).reduce<BoardOps>(
        (acc, o) => ({ create: [...acc.create, ...o.create], update: [...acc.update, ...o.update], delete: [...acc.delete, ...o.delete] }),
        empty(),
      );
      navigator.sendBeacon?.(`/api/boards/${boardId}/ops`, new Blob([JSON.stringify(merged)], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [boardId, flush]);

  /** Apply a change locally, persist it, and record it for undo. */
  const commit = useCallback(
    (forward: Partial<BoardOps>, backward: Partial<BoardOps> | null, label: string) => {
      const f = { ...empty(), ...forward };
      setItems((cur) => applyLocal(cur, f, boardId));
      enqueue(f);
      if (backward) {
        undoStack.current.push({ forward: f, backward: { ...empty(), ...backward }, label });
        if (undoStack.current.length > 200) undoStack.current.shift();
        redoStack.current = [];
      }
      bump();
    },
    [boardId, bump, enqueue],
  );

  const undo = useCallback(() => {
    const c = undoStack.current.pop();
    if (!c) return null;
    setItems((cur) => applyLocal(cur, c.backward, boardId));
    enqueue(c.backward);
    redoStack.current.push(c);
    bump();
    return c.label;
  }, [boardId, bump, enqueue]);

  const redo = useCallback(() => {
    const c = redoStack.current.pop();
    if (!c) return null;
    setItems((cur) => applyLocal(cur, c.forward, boardId));
    enqueue(c.forward);
    undoStack.current.push(c);
    bump();
    return c.label;
  }, [boardId, bump, enqueue]);

  const maxZ = useMemo(() => Math.max(0, ...[...items.values()].map((i) => i.z)), [items]);

  return {
    boardId,
    items,
    itemsRef,
    references,
    setReferences,
    childBoards,
    setChildBoards,
    commit,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    flush,
    saving,
    maxZ,
  };
}
export type BoardStore = ReturnType<typeof useBoard>;
