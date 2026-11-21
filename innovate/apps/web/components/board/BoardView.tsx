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
import { ShellSlot } from "@/components/shell/ShellSlot";

const Glyph = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const HomeIcon = () => <Glyph d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" size={16} />;

const TOOLS: { tool: Tool | "arrow" | "upload"; label: string; icon: string; hint: string; tile: string }[] = [
  { tool: "note", label: "Note", icon: "M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 9h7M8.5 12.5h7M8.5 16h4", hint: "N", tile: "bg-board-4" },
  { tool: "link", label: "Link", icon: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1", hint: "", tile: "bg-board-1" },
  { tool: "column", label: "Column", icon: "M8 3.5h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8.5 8h7M8.5 11.5h7M8.5 15h7", hint: "", tile: "bg-board-2" },
  { tool: "board", label: "Board", icon: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM7.5 7.5h3.5v3.5H7.5zM13 7.5h3.5v3.5H13zM7.5 13h3.5v3.5H7.5z", hint: "", tile: "bg-board-3" },
  { tool: "swatch", label: "Colour", icon: "M12 3.5c3 3.6 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.9 6-10.5z", hint: "", tile: "bg-board-5" },
  { tool: "arrow", label: "Arrow", icon: "M5 19 19 5M19 5h-6M19 5v6", hint: "", tile: "bg-board-6" },
  { tool: "upload", label: "Upload", icon: "M12 16V4M7 9l5-5 5 5M5 20h14", hint: "", tile: "bg-label-slate" },
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
      className={`group/tool flex w-[58px] flex-col items-center gap-1 rounded-lg pt-1.5 pb-1 text-2xs font-medium ${active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-3 hover:text-text"}`}
      data-tool={t.tool}
    >
      <span className={`grid h-8 w-8 place-items-center rounded-[9px] text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.12)] transition-transform group-hover/tool:-translate-y-px ${t.tile}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={t.icon} />
        </svg>
      </span>
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

function Tray({ items, onClose, onUpload }: { items: RefLite[]; onClose(): void; onUpload(): void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  return (
    <aside ref={setNodeRef} className={`z-10 flex min-h-0 w-[260px] shrink-0 flex-col bg-surface shadow-[-1px_0_0_var(--in-border),-4px_0_16px_rgba(0,0,0,0.05)] ${isOver ? "ring-2 ring-accent ring-inset" : ""}`} aria-label="Unsorted" data-testid="tray">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="text-md font-semibold">
          Unsorted <span className="ml-1 font-normal text-text-faint tabular">{items.length}</span>
        </h2>
        <button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text" aria-label="Close Unsorted">
          <Glyph d="M6 6l12 12M18 6 6 18" size={14} />
        </button>
      </div>
      <p className="px-4 pt-1 pb-3 text-xs leading-4 text-text-faint">New uploads and saved exports wait here. Drag them onto the board, or drag cards back.</p>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
        {items.map((r) => (
          <TrayItem key={r.id} r={r} />
        ))}
        {items.length === 0 && <li className="col-span-2 rounded-md border border-dashed border-border-strong p-4 text-center text-xs text-text-faint">All sorted.</li>}
      </ul>
      <div className="border-t border-border p-3">
        <button type="button" onClick={onUpload} className="h-8 w-full rounded-md bg-surface-3 text-sm hover:bg-surface-4">
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
  // Unsorted lives at the bottom of the tool rail and opens as a panel beside it (closed by default).
  const [trayOpen, setTrayOpen] = useState(false);
  const [arrowMode, setArrowMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const createRef = useRef<((tool: Tool, at?: { x: number; y: number }) => void) | null>(null);
  const zoomRef = useRef<{ zoomBy(f: number): void; reset(): void; fit(): void; zoom: number } | null>(null);
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
      <ShellSlot slot="crumbs">
        {initial.board.isHome ? (
          <span className="flex items-center gap-1.5 px-1 text-text-muted">
            <HomeIcon />
            Home
          </span>
        ) : (
          <>
            {initial.breadcrumbs.slice(0, -1).map((b, i) => (
              <span key={b.id} className="flex min-w-0 items-center gap-1">
                <Link href={i === 0 ? "/" : `/boards/${b.id}`} className="flex max-w-[160px] items-center gap-1.5 truncate rounded-sm px-1 text-text-muted hover:text-text">
                  {i === 0 && initial.breadcrumbs[0]?.title === "Home" ? (
                    <>
                      <HomeIcon />
                      Home
                    </>
                  ) : (
                    b.title
                  )}
                </Link>
                <span className="text-text-faint">/</span>
              </span>
            ))}
            <span className="max-w-[160px] truncate px-1 text-text">{title}</span>
          </>
        )}
        <span className="ml-1 shrink-0 text-xs text-text-faint" aria-live="polite">
          {store.saving === "saving" ? "Saving…" : store.saving === "error" ? "Not saved" : ""}
        </span>
      </ShellSlot>
      <ShellSlot slot="title">
        {editingTitle && !initial.board.isHome ? (
          <input
            autoFocus
            defaultValue={title}
            onBlur={(e) => void saveTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle(e.currentTarget.value);
              if (e.key === "Escape") setEditingTitle(false);
            }}
            aria-label="Board title"
            className="h-8 w-[320px] rounded-sm border border-border-strong bg-surface px-2 text-center font-serif text-[19px] font-semibold focus:border-accent focus:outline-none"
          />
        ) : (
          <h1>
            <button
              type="button"
              onClick={() => !initial.board.isHome && setEditingTitle(true)}
              className="max-w-[36vw] truncate rounded-sm px-2 font-serif text-[19px] leading-8 font-semibold tracking-[-0.01em] hover:bg-surface-3"
              title={initial.board.isHome ? undefined : "Rename"}
              data-testid="board-title"
            >
              {initial.board.isHome ? "Home" : title}
            </button>
          </h1>
        )}
      </ShellSlot>
      <ShellSlot slot="actions">
        <Presence members={members} selfId={selfId} />
        <div className="mx-1 flex rounded-md bg-surface-3 p-0.5 text-xs" role="group" aria-label="Board view">
          {(["canvas", "grid"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => void switchView(v)} className={`rounded-sm px-2 py-0.5 ${view === v ? "bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-muted hover:text-text"}`}>
              {v === "canvas" ? "Canvas" : "Grid"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPanel((p) => (p?.kind === "activity" ? null : { kind: "activity" }))}
          aria-pressed={panel?.kind === "activity"}
          className={`h-8 rounded-md px-2 text-sm ${panel?.kind === "activity" ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-3"}`}
        >
          Activity
        </button>
        <ShareDialog boardId={store.boardId} onError={(m) => toast(m, "error")} />
      </ShellSlot>

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
            left={null}
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
              ) : trayOpen ? (
                <Tray items={unsorted} onClose={() => setTrayOpen(false)} onUpload={() => fileInput.current?.click()} />
              ) : null
            }
            overlay={
              <>
                {/* Floating menu bar (Storyflow-style): everything you can put on the board. */}
                <aside
                  className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-24px)] flex-col items-center gap-0.5 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_24px_rgba(0,0,0,0.10)]"
                  aria-label="Add to board"
                >
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

                {/* View controls, top right: zoom, fit, undo/redo, Unsorted. */}
                <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-xl bg-surface p-1 text-text-muted shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.08)]">
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3 hover:text-text" onClick={() => zoomRef.current?.zoomBy(1 / 1.2)} aria-label="Zoom out">
                      <Glyph d="M6 12h12" size={16} />
                    </button>
                    <button type="button" className="h-7 w-12 rounded-md font-mono text-xs tabular hover:bg-surface-3 hover:text-text" onClick={() => zoomRef.current?.reset()} title="Reset zoom (0)">
                      {Math.round(zoom * 100)}%
                    </button>
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3 hover:text-text" onClick={() => zoomRef.current?.zoomBy(1.2)} aria-label="Zoom in">
                      <Glyph d="M12 6v12M6 12h12" size={16} />
                    </button>
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3 hover:text-text" onClick={() => zoomRef.current?.fit()} aria-label="Fit board to screen" title="Fit to screen">
                      <Glyph d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" size={16} />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-border" />
                    <button type="button" onClick={() => store.undo()} disabled={!store.canUndo} className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3 hover:text-text disabled:opacity-35" title="Undo (⌘Z)" aria-label="Undo">
                      <Glyph d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" size={16} />
                    </button>
                    <button type="button" onClick={() => store.redo()} disabled={!store.canRedo} className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3 hover:text-text disabled:opacity-35" title="Redo (⇧⌘Z)" aria-label="Redo">
                      <Glyph d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" size={16} />
                    </button>
                  </div>
                  {!trayOpen && (
                    <button
                      type="button"
                      onClick={() => setTrayOpen(true)}
                      className="h-9 rounded-xl bg-surface px-3 text-xs text-text-muted shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.08)] hover:text-text"
                      aria-label="Show Unsorted"
                    >
                      <span className="font-semibold text-text tabular">{unsorted.length}</span> Unsorted
                    </button>
                  )}
                </div>

                {/* Ask bar, bottom centre: opens the agent command bar (⌘K). */}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("innovate:ask"))}
                  className="absolute bottom-4 left-1/2 z-10 flex h-10 w-[min(420px,calc(100%-220px))] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-surface px-3.5 text-sm text-text-faint shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_24px_rgba(0,0,0,0.12)] hover:text-text-muted"
                  data-testid="ask-bar"
                >
                  <span className="text-accent">
                    <Glyph d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" size={17} />
                  </span>
                  <span className="flex-1 truncate text-left">Ask Innovate to research, build a moodboard, draft a deck…</span>
                  <kbd className="rounded-sm border border-border px-1 text-2xs text-text-faint">⌘K</kbd>
                </button>

                {arrowMode && (
                  <div className="pointer-events-none absolute top-14 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface px-3 py-1 text-xs text-accent shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
                    Arrow: click the first card, then the second. Esc cancels.
                  </div>
                )}
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
