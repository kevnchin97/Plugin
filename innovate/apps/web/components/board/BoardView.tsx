"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityList, FeedbackContext, Presence, ShareDialog } from "@/components/feedback/BoardSocial";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import type { ActivityDTO, CommentDTO, FeedbackData } from "@/lib/feedback";
import { useRealtime } from "@/lib/useRealtime";
import { useToast } from "@/components/ui/Toasts";
import type { BoardData, RefLite } from "@/lib/boards";
import { uploadFiles } from "@/lib/upload";
import { BoardCanvas, type Tool } from "./BoardCanvas";
import { BoardGrid } from "./BoardGrid";
import { ReferenceBody } from "./cards";
import { CLIENT_ID, useBoard } from "./useBoard";

const TOOLS: { tool: Tool | "arrow" | "upload"; label: string; icon: string; hint: string }[] = [
  { tool: "note", label: "Note", icon: "M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 9h7M8.5 12.5h7M8.5 16h4", hint: "N" },
  { tool: "link", label: "Link", icon: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1", hint: "" },
  { tool: "column", label: "Column", icon: "M8 3.5h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8.5 8h7M8.5 11.5h7M8.5 15h7", hint: "" },
  { tool: "board", label: "Board", icon: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM7.5 7.5h3.5v3.5H7.5zM13 7.5h3.5v3.5H13zM7.5 13h3.5v3.5H7.5z", hint: "" },
  { tool: "arrow", label: "Arrow", icon: "M5 19 19 5M19 5h-6M19 5v6", hint: "" },
  { tool: "upload", label: "Upload", icon: "M12 16V4M7 9l5-5 5 5M5 20h14", hint: "" },
];

function ToolButton({ t, active, onClick }: { t: (typeof TOOLS)[number]; active: boolean; onClick(): void }) {
  const draggable = t.tool !== "arrow" && t.tool !== "upload";
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `tool:${t.tool}`, data: { type: "tool", tool: t.tool }, disabled: !draggable });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={onClick}
      aria-pressed={t.tool === "arrow" ? active : undefined}
      title={`${t.label}${draggable ? " (click to add, or drag onto the board)" : ""}${t.hint ? ` · ${t.hint}` : ""}`}
      className={`flex w-[52px] flex-col items-center gap-0.5 rounded-md pt-1.5 pb-1 text-2xs ${active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-3 hover:text-text"}`}
      data-tool={t.tool}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={t.icon} />
      </svg>
      {t.label}
    </button>
  );
}

function TrayItem({ r }: { r: RefLite }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tray:${r.id}`, data: { type: "tray", ref: r } });
  const [hover, setHover] = useState(false);
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`cursor-grab overflow-hidden rounded-md border border-border bg-surface text-left ${isDragging ? "opacity-35" : ""}`}
      data-testid="tray-item"
      aria-label={`${r.title}, drag onto the board`}
    >
      <ReferenceBody reference={r} hovering={hover} />
    </li>
  );
}

function Tray({ items, open, onToggle, onUpload }: { items: RefLite[]; open: boolean; onToggle(): void; onUpload(): void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  if (!open)
    return (
      <button type="button" onClick={onToggle} className="w-9 border-l border-border bg-surface-2 text-2xs text-text-muted [writing-mode:vertical-rl] hover:text-text" aria-label="Show Unsorted">
        Unsorted · {items.length}
      </button>
    );
  return (
    <aside ref={setNodeRef} className={`flex min-h-0 w-[252px] flex-col border-l bg-surface-2 ${isOver ? "border-accent bg-accent-soft" : "border-border"}`} aria-label="Unsorted" data-testid="tray">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <h2 className="text-sm font-semibold">
          Unsorted <span className="ml-1 font-normal text-text-faint tabular">{items.length}</span>
        </h2>
        <button type="button" onClick={onToggle} className="text-xs text-text-faint hover:text-text" aria-label="Hide Unsorted">
          Hide
        </button>
      </div>
      <p className="px-3.5 pt-1 pb-2.5 text-2xs leading-4 text-text-faint">New uploads and saved exports land here. Drag them onto the board, or drag cards back here.</p>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-2.5 pb-3">
        {items.map((r) => (
          <TrayItem key={r.id} r={r} />
        ))}
        {items.length === 0 && <li className="col-span-2 rounded-md border border-dashed border-border-strong p-4 text-center text-2xs text-text-faint">All sorted.</li>}
      </ul>
      <div className="border-t border-border p-2.5">
        <button type="button" onClick={onUpload} className="h-7 w-full rounded-md border border-border-strong bg-surface text-xs hover:bg-surface-3">
          Upload images or video…
        </button>
      </div>
    </aside>
  );
}

export function BoardView({ initial, initialUnsorted, selfId }: { initial: BoardData; initialUnsorted: RefLite[]; selfId: string }) {
  const toast = useToast();
  const onError = useCallback((m: string) => toast(m, "error"), [toast]);
  const store = useBoard(initial, onError);
  const [title, setTitle] = useState(initial.board.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [view, setView] = useState(initial.board.view);
  const [unsorted, setUnsorted] = useState(initialUnsorted);
  const [trayOpen, setTrayOpen] = useState(true);
  const [arrowMode, setArrowMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const createRef = useRef<((tool: Tool, at?: { x: number; y: number }) => void) | null>(null);
  const zoomRef = useRef<{ zoomBy(f: number): void; reset(): void; zoom: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const search = useSearchParams();
  const [feedback, setFeedback] = useState<FeedbackData>({ comments: [], favorites: {} });
  const [activity, setActivity] = useState<ActivityDTO[]>([]);
  const [panel, setPanel] = useState<null | { kind: "feedback"; refId: string } | { kind: "activity" }>(() => {
    const ref = search.get("ref");
    return ref ? { kind: "feedback", refId: ref } : null;
  });

  useEffect(() => {
    void fetch(`/api/boards/${store.boardId}/feedback`).then(async (r) => {
      if (!r.ok) return;
      const json = (await r.json()) as FeedbackData & { activity: ActivityDTO[] };
      setFeedback({ comments: json.comments, favorites: json.favorites });
      setActivity(json.activity);
    });
  }, [store.boardId]);

  const upsertComment = useCallback((c: CommentDTO) => setFeedback((f) => ({ ...f, comments: [...f.comments.filter((x) => x.id !== c.id), c] })), []);
  const { applyRemote } = store;
  const onEvent = useCallback(
    (e: { type: string; [k: string]: unknown }) => {
      if (e.type === "comment" || e.type === "comment-updated") {
        const c = e.comment as CommentDTO;
        if (e.type === "comment" && c.authorKind === "guest") toast(`${c.authorName} commented: “${c.body.slice(0, 60)}”`);
        upsertComment(c);
      } else if (e.type === "favorite") {
        const ev = e as unknown as { referenceId: string; count: number; by: string; on: boolean };
        setFeedback((f) => ({ ...f, favorites: { ...f.favorites, [ev.referenceId]: { count: ev.count, mine: f.favorites[ev.referenceId]?.mine ?? false } } }));
      } else if (e.type === "activity") {
        setActivity((a) => [e.entry as ActivityDTO, ...a.filter((x) => x.id !== (e.entry as ActivityDTO).id)].slice(0, 50));
      } else if (e.type === "ops" && e.clientId !== CLIENT_ID) {
        void applyRemote(e.ops as Parameters<typeof applyRemote>[0]);
      }
    },
    [applyRemote, toast, upsertComment],
  );
  const { members } = useRealtime(`/api/realtime/ticket?boardId=${store.boardId}`, onEvent);

  const counts = useMemo(() => {
    const out: Record<string, { comments: number; favorites: number }> = {};
    for (const c of feedback.comments) if (!c.resolvedAt) (out[c.referenceId] ??= { comments: 0, favorites: 0 }).comments++;
    for (const [ref, f] of Object.entries(feedback.favorites)) (out[ref] ??= { comments: 0, favorites: 0 }).favorites = f.count;
    return out;
  }, [feedback]);
  const feedbackCtx = useMemo(() => ({ counts, open: (refId: string) => setPanel({ kind: "feedback", refId }) }), [counts]);
  const panelRef = panel?.kind === "feedback" ? store.references[panel.refId] : undefined;

  // Keep processing videos fresh until they're ready.
  const processing = Object.values(store.references).some((r) => r.status !== "ready") || unsorted.some((r) => r.status !== "ready");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(async () => {
      const [b, u] = await Promise.all([fetch(`/api/boards/${store.boardId}`), fetch("/api/unsorted")]);
      if (b.ok) store.setReferences((await b.json()).references);
      if (u.ok) setUnsorted((await u.json()).references);
    }, 2000);
    return () => clearInterval(t);
  }, [processing, store]);

  const saveTitle = async (t: string) => {
    setEditingTitle(false);
    const next = t.trim() || "Untitled board";
    if (next === title) return;
    setTitle(next);
    await fetch(`/api/boards/${store.boardId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: next }) });
  };
  const switchView = async (v: "canvas" | "grid") => {
    setView(v);
    await fetch(`/api/boards/${store.boardId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ view: v }) });
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const created = await uploadFiles([...files], (m) => toast(m, "error"));
    if (created.length) {
      const u = await fetch("/api/unsorted");
      if (u.ok) setUnsorted((await u.json()).references);
      toast(`${created.length} ${created.length === 1 ? "file" : "files"} added to Unsorted`, "success");
      setTrayOpen(true);
    }
  };

  return (
    <FeedbackContext.Provider value={feedbackCtx}>
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
        <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center gap-1.5 text-text-faint">
          <Link href="/" className="hover:text-text">
            Boards
          </Link>
          {initial.breadcrumbs.slice(0, -1).map((b) => (
            <span key={b.id} className="flex items-center gap-1.5">
              <span>/</span>
              <Link href={`/boards/${b.id}`} className="max-w-[160px] truncate hover:text-text">
                {b.title}
              </Link>
            </span>
          ))}
          <span>/</span>
        </nav>
        {editingTitle ? (
          <input
            autoFocus
            defaultValue={title}
            onBlur={(e) => void saveTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle(e.currentTarget.value);
              if (e.key === "Escape") setEditingTitle(false);
            }}
            aria-label="Board title"
            className="h-7 rounded-sm border border-border-strong bg-surface px-2 font-medium focus:border-accent focus:outline-none"
          />
        ) : (
          <h1>
            <button type="button" onClick={() => setEditingTitle(true)} className="truncate font-medium hover:underline" title="Rename" data-testid="board-title">
              {title}
            </button>
          </h1>
        )}
        <span className="ml-1 text-xs text-text-faint" aria-live="polite">
          {store.saving === "saving" ? "Saving…" : store.saving === "error" ? "Not saved" : "Saved"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Presence members={members} selfId={selfId} />
          <button
            type="button"
            onClick={() => setPanel((p) => (p?.kind === "activity" ? null : { kind: "activity" }))}
            aria-pressed={panel?.kind === "activity"}
            className={`h-7 rounded-md px-2 text-xs ${panel?.kind === "activity" ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-3"}`}
          >
            Activity
          </button>
          <ShareDialog boardId={store.boardId} onError={(m) => toast(m, "error")} />
          <button type="button" onClick={() => store.undo()} disabled={!store.canUndo} className="h-7 rounded-md px-2 text-xs text-text-muted hover:bg-surface-3 disabled:opacity-40" title="Undo (⌘Z)">
            Undo
          </button>
          <button type="button" onClick={() => store.redo()} disabled={!store.canRedo} className="h-7 rounded-md px-2 text-xs text-text-muted hover:bg-surface-3 disabled:opacity-40" title="Redo (⇧⌘Z)">
            Redo
          </button>
          <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Board view">
            {(["canvas", "grid"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => void switchView(v)} className={`rounded-sm px-2 py-0.5 ${view === v ? "bg-surface-3 text-text" : "text-text-muted hover:text-text"}`}>
                {v === "canvas" ? "Canvas" : "Grid"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {view === "canvas" ? (
          <BoardCanvas
            store={store}
            unsorted={unsorted}
            onPlacedFromTray={(ids) => setUnsorted((u) => u.filter((r) => !ids.includes(r.id)))}
            onReturnedToTray={(refs) => setUnsorted((u) => [...refs.filter((r) => !u.some((x) => x.id === r.id)), ...u])}
            arrowMode={arrowMode}
            setArrowMode={setArrowMode}
            createRef={createRef}
            zoomRef={zoomRef}
            onZoom={setZoom}
            left={
              <aside className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border pt-3" aria-label="Add to board">
                {TOOLS.map((t) => (
                  <ToolButton
                    key={t.tool}
                    t={t}
                    active={t.tool === "arrow" && arrowMode}
                    onClick={() => {
                      if (t.tool === "arrow") setArrowMode(!arrowMode);
                      else if (t.tool === "upload") fileInput.current?.click();
                      else createRef.current?.(t.tool);
                    }}
                  />
                ))}
              </aside>
            }
            right={
              panel?.kind === "feedback" && panelRef ? (
                <FeedbackPanel
                  key={panelRef.id}
                  reference={panelRef}
                  comments={feedback.comments.filter((c) => c.referenceId === panelRef.id)}
                  favorite={feedback.favorites[panelRef.id] ?? { count: 0, mine: false }}
                  api={{
                    feedbackUrl: `/api/boards/${store.boardId}/feedback`,
                    mediaUrl: `/api/references/${panelRef.id}/media`,
                    resolveUrl: (id) => `/api/comments/${id}`,
                  }}
                  canFavorite
                  canComment
                  canResolve
                  onClose={() => setPanel(null)}
                  onFavorite={(r) => setFeedback((f) => ({ ...f, favorites: { ...f.favorites, [panelRef.id]: { count: r.count, mine: r.on } } }))}
                  onComment={upsertComment}
                  onError={(m) => toast(m, "error")}
                />
              ) : panel?.kind === "activity" ? (
                <aside className="flex min-h-0 w-[300px] flex-col border-l border-border bg-surface-2" aria-label="Activity">
                  <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
                    <h2 className="text-sm font-semibold">Activity</h2>
                    <button type="button" onClick={() => setPanel(null)} className="text-xs text-text-faint hover:text-text">
                      Close
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <ActivityList entries={activity} />
                  </div>
                </aside>
              ) : (
                <Tray items={unsorted} open={trayOpen} onToggle={() => setTrayOpen(!trayOpen)} onUpload={() => fileInput.current?.click()} />
              )
            }
            overlay={
              <>
                <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-0.5 text-xs text-text-muted shadow-[0_1px_2px_rgba(33,29,24,0.06)]">
                  <button type="button" className="px-1.5 hover:text-text" onClick={() => zoomRef.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">
                    −
                  </button>
                  <button type="button" className="w-12 font-mono tabular hover:text-text" onClick={() => zoomRef.current?.reset()} title="Reset zoom (0)">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button type="button" className="px-1.5 hover:text-text" onClick={() => zoomRef.current?.zoomBy(1.2)} aria-label="Zoom in">
                    +
                  </button>
                </div>
                <div className="pointer-events-none absolute bottom-3 left-4 flex gap-3.5 text-2xs text-text-faint">
                  {arrowMode ? (
                    <span className="text-accent">Arrow: click the first card, then the second. Esc cancels.</span>
                  ) : (
                    <>
                      <span>N for a note</span>
                      <span>Space + drag to pan</span>
                      <span>⌘ + scroll to zoom</span>
                      <span>Shift + click to multi-select</span>
                    </>
                  )}
                </div>
              </>
            }
          />
        ) : (
          <BoardGrid store={store} />
        )}
      </div>
      <input ref={fileInput} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="sr-only" aria-label="Upload files" data-testid="board-file-input" onChange={(e) => { void onUpload(e.target.files); e.target.value = ""; }} />
    </div>
    </FeedbackContext.Provider>
  );
}
