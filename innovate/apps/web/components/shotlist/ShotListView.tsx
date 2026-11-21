"use client";
import { type CollisionDetection, DndContext, type DragEndEvent, DragOverlay, type DragStartEvent, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FRAMING_LABEL, FRAMINGS, formatShotDuration, positionBetween, SHOT_STATUSES, type ShotPatch, type ShotStatus } from "@innovate/shared";
import { aspectOf, ReferenceBody } from "@/components/board/cards";
import { ShareDialog } from "@/components/feedback/BoardSocial";
import { MotionMedia } from "@/components/media/MotionMedia";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";
import type { ShotDTO, ShotListData } from "@/lib/shotlists";
import { useRealtime } from "@/lib/useRealtime";

const CLIENT_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const STATUS_TONE: Record<ShotStatus, string> = {
  idea: "bg-surface-4 text-text-muted",
  planned: "bg-[color-mix(in_srgb,var(--in-accent)_12%,transparent)] text-accent",
  approved: "bg-[color-mix(in_srgb,var(--in-success)_14%,transparent)] text-success",
  shot: "bg-text text-bg",
};
const GRID = "grid-cols-[28px_52px_64px_minmax(120px,1fr)_minmax(200px,2fr)_92px_minmax(140px,1.1fr)_76px_104px_200px_28px]";

async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json", "x-client-id": CLIENT_ID }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/** A text cell that edits locally and saves on blur (and after a pause while typing). */
function Cell({ value, onSave, label, multiline, placeholder, mono }: { value: string; onSave(v: string): void; label: string; multiline?: boolean; placeholder?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = focused ? v : value;
  const commit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (next !== value) onSave(next);
  };
  const onFocus = () => {
    setV(value);
    setFocused(true);
  };
  const onBlur = () => {
    setFocused(false);
    commit(v);
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    setV(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => next !== value && onSave(next), 800);
  };
  const cls = `w-full rounded-xs border border-transparent bg-transparent px-1.5 py-1 text-sm placeholder:text-text-faint hover:border-border focus:border-accent focus:bg-surface focus:outline-none ${mono ? "font-mono tabular" : ""}`;
  if (multiline)
    return (
      <textarea
        value={shown}
        aria-label={label}
        placeholder={placeholder}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={onChange}
        rows={Math.max(1, Math.min(6, (shown.match(/\n/g)?.length ?? 0) + 1 + Math.floor(shown.length / 46)))}
        className={`${cls} resize-none leading-[18px]`}
      />
    );
  return <input value={shown} aria-label={label} placeholder={placeholder} onFocus={onFocus} onBlur={onBlur} onChange={onChange} className={cls} />;
}

function MotionCell({ shot, reference, onOpen, onClear, readOnly }: { shot: ShotDTO; reference?: RefLite; onOpen(r: RefLite): void; onClear(): void; readOnly?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `motion:${shot.id}`, disabled: readOnly });
  const box = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        box.current = n;
      }}
      className={`relative rounded-sm ${isOver ? "outline-2 outline-accent outline-dashed" : ""}`}
      data-testid="motion-cell"
    >
      {reference ? (
        <div className="group relative">
          <button type="button" onClick={() => onOpen(reference)} className="block w-full overflow-hidden rounded-sm bg-player" style={{ aspectRatio: aspectOf(reference) }} aria-label={`Open ${reference.title} full size`}>
            {/* Inline looping thumbnail while it's on screen (never with reduced motion). */}
            <MotionMedia item={reference} active={visible} />
          </button>
          <div className="mt-0.5 truncate text-2xs text-text-faint" title={reference.title}>
            {reference.title}
          </div>
          {!readOnly && (
            <button type="button" onClick={onClear} className="absolute top-1 right-1 hidden h-5 w-5 place-items-center rounded-full bg-black/70 text-2xs text-white group-hover:grid" aria-label="Remove motion reference">
              ×
            </button>
          )}
        </div>
      ) : readOnly ? null : (
        <div className="grid h-[58px] place-items-center rounded-sm border border-dashed border-border-strong text-center text-2xs leading-4 text-text-faint">
          Drop a reference
        </div>
      )}
    </div>
  );
}

const ShotRow = memo(function ShotRow({
  shot,
  reference,
  onPatch,
  onDelete,
  onOpen,
  onMove,
}: {
  shot: ShotDTO;
  reference?: RefLite;
  onPatch(id: string, p: ShotPatch): void;
  onDelete(id: string): void;
  onOpen(r: RefLite): void;
  onMove(id: string, dir: -1 | 1): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  const p = (patch: ShotPatch) => onPatch(shot.id, patch);
  return (
    <div
      ref={setNodeRef}
      id={`shot-${shot.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`grid ${GRID} items-start gap-x-1.5 border-b border-border bg-surface px-2 py-1.5 focus-within:bg-surface-2`}
      data-testid="shot-row"
      onKeyDown={(e) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onMove(shot.id, e.key === "ArrowUp" ? -1 : 1);
        }
      }}
    >
      <button type="button" {...attributes} {...listeners} className="mt-1 grid h-7 cursor-grab place-items-center rounded-xs text-text-faint hover:bg-surface-3" aria-label={`Reorder shot ${shot.number} (or Alt+↑/↓)`}>
        ⋮⋮
      </button>
      <Cell value={shot.number} label="Shot number" onSave={(v) => p({ number: v })} mono />
      <Cell value={shot.scene} label="Scene" placeholder="Sc." onSave={(v) => p({ scene: v })} />
      <Cell value={shot.setting} label="Setting" placeholder="Location" onSave={(v) => p({ setting: v })} />
      <Cell value={shot.description} label="Description" placeholder="What happens" multiline onSave={(v) => p({ description: v })} />
      <select
        value={shot.framing ?? ""}
        onChange={(e) => p({ framing: (e.target.value || null) as ShotPatch["framing"] })}
        aria-label="Framing"
        title={shot.framing ? FRAMING_LABEL[shot.framing] : undefined}
        className="mt-0.5 h-7 rounded-xs border border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-accent focus:outline-none"
      >
        <option value="">–</option>
        {FRAMINGS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <div className="flex flex-col">
        <Cell value={shot.movement} label="Camera movement" placeholder="Movement" onSave={(v) => p({ movement: v })} />
        <Cell value={shot.lens} label="Lens" placeholder="Lens" onSave={(v) => p({ lens: v })} />
        <Cell value={shot.rig} label="Rig" placeholder="Rig" onSave={(v) => p({ rig: v })} />
      </div>
      <Cell
        value={shot.durationSec === null ? "" : String(shot.durationSec)}
        label="Duration in seconds"
        placeholder="sec"
        mono
        onSave={(v) => {
          const n = Number(v.replace(",", "."));
          p({ durationSec: v.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, n) });
        }}
      />
      <select
        value={shot.status}
        onChange={(e) => p({ status: e.target.value as ShotStatus })}
        aria-label="Status"
        className={`mt-0.5 h-7 rounded-full border-0 px-2.5 text-xs font-medium capitalize focus:outline-2 focus:outline-accent ${STATUS_TONE[shot.status]}`}
      >
        {SHOT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <MotionCell shot={shot} reference={reference} onOpen={onOpen} onClear={() => p({ motionReferenceId: null })} />
      <button type="button" onClick={() => onDelete(shot.id)} className="mt-1 grid h-7 place-items-center rounded-xs text-text-faint hover:bg-surface-3 hover:text-danger" aria-label={`Delete shot ${shot.number}`}>
        ×
      </button>
    </div>
  );
});

function RefTile({ r }: { r: RefLite }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `ref:${r.id}`, data: { ref: r } });
  const [hover, setHover] = useState(false);
  return (
    <li ref={setNodeRef} {...listeners} {...attributes} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className={`cursor-grab overflow-hidden rounded-md border border-border bg-surface ${isDragging ? "opacity-35" : ""}`} data-testid="ref-tile" aria-label={`${r.title}: drag onto a shot`}>
      <ReferenceBody reference={r} hovering={hover} />
    </li>
  );
}

function NewShot({ onAdd }: { onAdd(): void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "new-shot" });
  return (
    <div ref={setNodeRef} className={`m-2 rounded-md border border-dashed p-3 text-center text-xs ${isOver ? "border-accent bg-accent-soft" : "border-border-strong text-text-faint"}`}>
      <Button size="sm" variant="secondary" onClick={onAdd}>
        + Add shot
      </Button>
      <span className="ml-3">or drop a reference here to start a shot with it</span>
    </div>
  );
}

export function ShotListView({ initial, boards }: { initial: ShotListData; boards: { id: string; title: string }[] }) {
  const toast = useToast();
  const listId = initial.list.id;
  const [title, setTitle] = useState(initial.list.title);
  const [shots, setShots] = useState(initial.shots);
  const [refs, setRefs] = useState<Record<string, RefLite>>(initial.references);
  const [group, setGroup] = useState<"none" | "scene" | "setting">("none");
  const [filter, setFilter] = useState<Set<ShotStatus>>(new Set());
  const [source, setSource] = useState<string>(initial.list.boardId ?? boards[0]?.id ?? "library");
  const [panelRefs, setPanelRefs] = useState<RefLite[]>([]);
  const [open, setOpen] = useState<RefLite | null>(null);
  const [dragRef, setDragRef] = useState<RefLite | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onError = useCallback((m: string) => toast(m, "error"), [toast]);

  const ordered = useMemo(() => [...shots].sort((a, b) => a.position - b.position), [shots]);
  const visible = ordered.filter((s) => filter.size === 0 || filter.has(s.status));
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: visible }];
    const m = new Map<string, ShotDTO[]>();
    for (const s of visible) {
      const k = (group === "scene" ? s.scene : s.setting).trim();
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].map(([key, rows]) => ({ key, rows }));
  }, [group, visible]);

  // References panel: one board's references, or the library.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (source === "library") {
        const r = await fetch("/api/references?limit=120");
        if (r.ok && !cancelled) setPanelRefs(((await r.json()).references as RefLite[]).filter((x) => x.type !== "link"));
      } else {
        const r = await fetch(`/api/boards/${source}`);
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { references: Record<string, RefLite> };
        setPanelRefs(Object.values(data.references));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const merge = useCallback((upsert: ShotDTO[] = [], remove: string[] = [], more: Record<string, RefLite> = {}) => {
    setShots((cur) => [...cur.filter((s) => !remove.includes(s.id) && !upsert.some((u) => u.id === s.id)), ...upsert]);
    if (Object.keys(more).length) setRefs((r) => ({ ...r, ...more }));
  }, []);

  const onEvent = useCallback(
    (e: { type: string; [k: string]: unknown }) => {
      if (e.type !== "ops" || e.clientId === CLIENT_ID) return;
      const ops = e.ops as { type: string; upsert?: ShotDTO[]; remove?: string[]; references?: Record<string, RefLite>; title?: string };
      if (ops.type === "shots") merge(ops.upsert, ops.remove, ops.references);
      if (ops.type === "list" && ops.title) setTitle(ops.title);
    },
    [merge],
  );
  const { members } = useRealtime(`/api/realtime/ticket?shotListId=${listId}`, onEvent);

  // Edits to one shot go to the server strictly in order, and a response is only applied when
  // nothing newer for that shot is pending; otherwise an older response could overwrite text
  // typed since, and a later blur would save that stale value back.
  const chains = useRef(new Map<string, { tail: Promise<void>; pending: number }>());
  const patch = useCallback(
    (id: string, p: ShotPatch) => {
      setShots((cur) => cur.map((s) => (s.id === id ? { ...s, ...p } : s)));
      const entry = chains.current.get(id) ?? { tail: Promise.resolve(), pending: 0 };
      entry.pending++;
      entry.tail = entry.tail.then(async () => {
        try {
          const r = await api<{ shot: ShotDTO; references: Record<string, RefLite> }>(`/api/shots/${id}`, "PATCH", p);
          if (entry.pending === 1) merge([r.shot], [], r.references);
          else if (Object.keys(r.references).length) setRefs((x) => ({ ...x, ...r.references }));
        } catch (err) {
          onError((err as Error).message);
        } finally {
          entry.pending--;
        }
      });
      chains.current.set(id, entry);
      return entry.tail;
    },
    [merge, onError],
  );
  const add = useCallback(
    async (motionReferenceId?: string) => {
      try {
        const r = await api<{ shot: ShotDTO; references: Record<string, RefLite> }>(`/api/shotlists/${listId}/shots`, "POST", motionReferenceId ? { motionReferenceId } : {});
        merge([r.shot], [], r.references);
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`#shot-${r.shot.id} textarea`)?.focus());
      } catch (err) {
        onError((err as Error).message);
      }
    },
    [listId, merge, onError],
  );
  const remove = useCallback(
    async (id: string) => {
      merge([], [id]);
      await api(`/api/shots/${id}`, "DELETE").catch((err) => onError((err as Error).message));
    },
    [merge, onError],
  );
  const moveTo = useCallback(
    (id: string, beforeId: string | null, afterId: string | null) => {
      const pos = (x: string | null) => (x ? (ordered.find((s) => s.id === x)?.position ?? null) : null);
      void patch(id, { position: positionBetween(pos(beforeId), pos(afterId)) });
    },
    [ordered, patch],
  );
  const step = useCallback(
    (id: string, dir: -1 | 1) => {
      const i = ordered.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ordered.length) return;
      const rest = ordered.filter((s) => s.id !== id);
      const at = dir < 0 ? j : j;
      moveTo(id, rest[at - 1]?.id ?? null, rest[at]?.id ?? null);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#shot-${id} button`)?.focus());
    },
    [moveTo, ordered],
  );

  // Rows only reorder against rows; references only drop on motion cells or the new-shot zone.
  const collision: CollisionDetection = useCallback((args) => {
    const isRef = String(args.active.id).startsWith("ref:");
    const droppableContainers = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      const isTarget = id.startsWith("motion:") || id === "new-shot";
      return isRef ? isTarget : !isTarget;
    });
    return isRef ? pointerWithin({ ...args, droppableContainers }) : closestCenter({ ...args, droppableContainers });
  }, []);

  const onDragStart = (e: DragStartEvent) => setDragRef((e.active.data.current as { ref?: RefLite } | undefined)?.ref ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragRef(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith("ref:")) {
      const ref = (e.active.data.current as { ref: RefLite }).ref;
      setRefs((r) => ({ ...r, [ref.id]: ref }));
      if (over?.startsWith("motion:")) void patch(over.slice(7), { motionReferenceId: ref.id });
      else if (over === "new-shot") void add(ref.id);
      else if (over && shots.some((s) => s.id === over)) void patch(over, { motionReferenceId: ref.id });
      return;
    }
    if (!over || over === active || !shots.some((s) => s.id === over)) return;
    const rest = ordered.filter((s) => s.id !== active);
    const from = ordered.findIndex((s) => s.id === active);
    const to = ordered.findIndex((s) => s.id === over);
    const idx = rest.findIndex((s) => s.id === over) + (to > from ? 1 : 0);
    moveTo(active, rest[idx - 1]?.id ?? null, rest[idx]?.id ?? null);
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const { job } = await api<{ job: { id: string } }>(`/api/shotlists/${listId}/pdf`, "POST");
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const r = await fetch(`/api/jobs/${job.id}`);
        const j = (await r.json()).job as { status: string; error: string | null; downloadUrl: string | null; output: { filename: string } | null };
        if (j.status === "failed") throw new Error(j.error ?? "PDF export failed");
        if (j.status === "completed" && j.downloadUrl) {
          const a = document.createElement("a");
          a.href = j.downloadUrl;
          a.download = j.output?.filename ?? "shot-list.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast("PDF ready", "success");
          return;
        }
      }
      throw new Error("The PDF is taking too long. Try again.");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  const saveTitle = async (t: string) => {
    const next = t.trim() || "Untitled shot list";
    setTitle(next);
    await api(`/api/shotlists/${listId}`, "PATCH", { title: next }).catch(() => {});
  };
  const totals = useMemo(() => ({ count: visible.length, seconds: visible.reduce((a, s) => a + (s.durationSec ?? 0), 0) }), [visible]);
  return (
    <DndContext id="shotlist-dnd" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
          <Link href="/shotlists" className="text-text-faint hover:text-text">
            Shot lists
          </Link>
          <span className="text-text-faint">/</span>
          <input defaultValue={title} key={title} onBlur={(e) => void saveTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label="Shot list title" className="h-7 min-w-[240px] rounded-sm border border-transparent bg-transparent px-1.5 font-medium hover:border-border focus:border-accent focus:outline-none" data-testid="shotlist-title" />
          <span className="text-xs text-text-faint tabular" data-testid="totals">
            {totals.count} shots · {formatShotDuration(totals.seconds) || "0s"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {members.length > 1 && <span className="text-xs text-text-faint">{members.length - 1} others here</span>}
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              Group
              <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label="Group shots by" className="h-7 rounded-sm border border-border-strong bg-surface px-1.5 text-xs">
                <option value="none">None</option>
                <option value="scene">Scene</option>
                <option value="setting">Location</option>
              </select>
            </label>
            <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Filter by status">
              {SHOT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={filter.has(s)}
                  onClick={() => setFilter((f) => (f.has(s) ? new Set([...f].filter((x) => x !== s)) : new Set([...f, s])))}
                  className={`rounded-sm px-2 py-0.5 capitalize ${filter.has(s) ? "bg-surface-3 text-text" : "text-text-muted hover:text-text"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <a href={`/api/shotlists/${listId}/csv`} download className="inline-flex h-7 items-center rounded-md px-2 text-xs text-text-muted hover:bg-surface-3 hover:text-text">
              CSV
            </a>
            <Button size="sm" variant="ghost" onClick={() => void exportPdf()} disabled={pdfBusy}>
              {pdfBusy ? "Rendering PDF…" : "PDF"}
            </Button>
            <ShareDialog boardId={listId} endpoint={`/api/shotlists/${listId}/shares`} viewOnly noun="shot list" onError={onError} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto" data-testid="shot-table">
            <div className="min-w-[1180px]">
              <div className={`sticky top-0 z-10 grid ${GRID} gap-x-1.5 border-b border-border-strong bg-bg px-2 py-2 text-2xs font-medium tracking-[0.1em] text-text-faint uppercase`}>
                <span />
                <span className="px-1.5">#</span>
                <span className="px-1.5">Scene</span>
                <span className="px-1.5">Setting</span>
                <span className="px-1.5">Description</span>
                <span className="px-1.5">Framing</span>
                <span className="px-1.5">Camera</span>
                <span className="px-1.5">Duration</span>
                <span className="px-1.5">Status</span>
                <span>Motion reference</span>
                <span />
              </div>
              <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {groups.map((g) => (
                  <section key={g.key || "all"} aria-label={group === "none" ? undefined : `${group === "scene" ? "Scene" : "Location"} ${g.key || "not set"}`}>
                    {group !== "none" && (
                      <h2 className="border-b border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold" data-testid="group-header">
                        {group === "scene" ? "Scene" : "Location"} {g.key || <span className="font-normal text-text-faint">not set</span>}
                        <span className="ml-2 font-normal text-text-faint">{g.rows.length}</span>
                      </h2>
                    )}
                    {g.rows.map((s) => (
                      <ShotRow key={s.id} shot={s} reference={s.motionReferenceId ? refs[s.motionReferenceId] : undefined} onPatch={(id, p) => void patch(id, p)} onDelete={(id) => void remove(id)} onOpen={setOpen} onMove={step} />
                    ))}
                  </section>
                ))}
              </SortableContext>
              {ordered.length > 0 && visible.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No shots with that status.</p>}
              <NewShot onAdd={() => void add()} />
            </div>
          </div>
          <aside className="flex min-h-0 w-[260px] shrink-0 flex-col border-l border-border bg-surface-2" aria-label="References">
            <div className="px-3 pt-3 pb-2">
              <h2 className="text-sm font-semibold">References</h2>
              <p className="mb-2 text-2xs text-text-faint">Drag onto a shot&apos;s motion cell, or below the list for a new shot.</p>
              <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Reference source" className="h-7 w-full rounded-sm border border-border-strong bg-surface px-1.5 text-xs">
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    Board: {b.title}
                  </option>
                ))}
                <option value="library">Library (everything)</option>
              </select>
            </div>
            <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-2.5 pb-3">
              {panelRefs.map((r) => (
                <RefTile key={r.id} r={r} />
              ))}
              {panelRefs.length === 0 && <li className="col-span-2 py-6 text-center text-2xs text-text-faint">No references here.</li>}
            </ul>
          </aside>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragRef ? (
          <div className="w-[160px] overflow-hidden rounded-md border border-border bg-surface shadow-[0_18px_40px_rgba(33,29,24,0.22)]">
            <ReferenceBody reference={dragRef} hovering={false} />
          </div>
        ) : null}
      </DragOverlay>
      <Dialog.Root open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 w-[min(960px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border-strong bg-surface focus:outline-none" data-testid="motion-lightbox">
            {open && (
              <>
                <div className="bg-player" style={{ aspectRatio: aspectOf(open) }}>
                  <MotionMedia item={open} active />
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <Dialog.Title className="text-md font-medium">{open.title}</Dialog.Title>
                  <Dialog.Close className="text-sm text-text-muted hover:text-text">Close</Dialog.Close>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DndContext>
  );
}
