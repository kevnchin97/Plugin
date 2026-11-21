"use client";
import { useMemo, useRef, useState } from "react";
import { trimmedDuration } from "@innovate/shared";
import { ShareDialog } from "@/components/feedback/BoardSocial";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";
import { download, runJob } from "@/lib/client-jobs";
import type { Playable, ReelData } from "@/lib/present";
import { saveLabel, useAutosave } from "@/lib/useAutosave";
import { ShellSlot } from "@/components/shell/ShellSlot";
import { MediaPicker } from "./MediaPicker";
import { reelDuration, ReelPlayer } from "./ReelPlayer";

type Item = ReelData["items"][number];
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Reel editor (SPEC §5.5): a sequence timeline of clips (width = trimmed length), trims per clip,
 * title and end cards, a live preview, a share link and an optional MP4 render on the worker.
 */
export function ReelEditor({ data, boards }: { data: ReelData; boards: { id: string; title: string }[] }) {
  const toast = useToast();
  const reelId = data.reel.id;
  const [fields, setFields] = useState({
    title: data.reel.title,
    titleCard: data.reel.titleCard,
    titleCardSub: data.reel.titleCardSub,
    endCard: data.reel.endCard,
    endCardSub: data.reel.endCardSub,
  });
  const [items, setItems] = useState<Item[]>(data.items);
  const [media, setMedia] = useState<Record<string, Playable | undefined>>(data.media);
  const [selected, setSelected] = useState<string | null>(data.items[0]?.id ?? null);
  const [render, setRender] = useState<{ busy: boolean; progress: number; url: string | null }>({ busy: false, progress: 0, url: data.reel.renderUrl });
  const [previewKey, setPreviewKey] = useState(0);
  const trimVideo = useRef<HTMLVideoElement>(null);

  const doc = useMemo(() => ({ ...fields, items }), [fields, items]);
  const { status, save } = useAutosave(
    `/api/reels/${reelId}`,
    doc,
    { onSaved: (body) => setMedia((m) => ({ ...m, ...(body as ReelData).media })), onError: (m) => toast(m, "error") },
    500,
  );

  const sel = items.find((i) => i.id === selected);
  const selMedia = sel ? media[sel.referenceId] : undefined;
  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const add = (r: RefLite) => {
    const item: Item = { id: crypto.randomUUID(), referenceId: r.id, inSec: null, outSec: null };
    setMedia((m) => ({ ...m, [r.id]: m[r.id] ?? { ...r, playUrl: null } }));
    setItems((cur) => [...cur, item]);
    setSelected(item.id);
  };
  const move = (id: string, by: number) =>
    setItems((cur) => {
      const i = cur.findIndex((x) => x.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const total = reelDuration({ ...fields, items, media });

  const renderMp4 = async () => {
    setRender((r) => ({ ...r, busy: true, progress: 0 }));
    try {
      await save();
      const job = await runJob(`/api/reels/${reelId}/render`, (p) => setRender((r) => ({ ...r, progress: p })));
      setRender({ busy: false, progress: 100, url: job.downloadUrl });
      if (job.downloadUrl) download(job.downloadUrl, job.output?.filename ?? "reel.mp4");
      toast("Reel rendered", "success");
    } catch (err) {
      setRender((r) => ({ ...r, busy: false }));
      toast((err as Error).message, "error");
    }
  };

  const field = (key: keyof typeof fields, label: string, placeholder = "") => (
    <label className="block text-xs text-text-muted">
      {label}
      <input value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text placeholder:text-text-faint" />
    </label>
  );

  return (
    <div className="flex h-full flex-col">
      <ShellSlot slot="crumbs">
        <span className="text-text-faint">/</span>
        <input value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} aria-label="Reel title" data-testid="reel-title" className="h-8 w-[min(420px,40vw)] min-w-0 rounded-md bg-transparent px-1 text-md font-medium hover:bg-surface-3 focus:bg-surface-3 focus:outline-none" />
        <span className="font-mono text-xs text-text-muted" data-testid="reel-total">
          {fmt(total)}
        </span>
        <span className="text-xs text-text-faint" role="status" data-testid="save-status">
          {saveLabel(status)}
        </span>
      </ShellSlot>
      <ShellSlot slot="actions">
        <ShareDialog boardId={reelId} endpoint={`/api/reels/${reelId}/shares`} viewOnly noun="reel" onError={(m) => toast(m, "error")} />
        <button type="button" onClick={renderMp4} disabled={render.busy || !items.length} className="h-8 rounded-md border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-60">
          {render.busy ? `Rendering ${Math.round(render.progress)}%` : "Render MP4"}
        </button>
        {render.url && !render.busy && (
          <a href={render.url} download className="text-sm text-accent hover:underline" data-testid="render-download">
            Download MP4
          </a>
        )}
      </ShellSlot>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px]">
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 p-5">
            <div>
              <div className="overflow-hidden rounded-md">
                <ReelPlayer key={previewKey} reel={{ ...fields, items, media }} />
              </div>
              <button type="button" onClick={() => setPreviewKey((k) => k + 1)} className="mt-2 text-xs text-text-muted hover:text-text">
                Restart preview
              </button>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Title card</div>
              {field("titleCard", "Title", "Your name")}
              {field("titleCardSub", "Subtitle", "Director · Cinematographer")}
              <div className="pt-2 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">End card</div>
              {field("endCard", "Title", "Thank you")}
              {field("endCardSub", "Contact", "name@studio.com")}
              <p className="text-2xs text-text-faint">Leave a title empty to skip that card.</p>
            </div>
          </div>

          {/* Sequence timeline */}
          <div className="border-t border-border px-5 py-4">
            <div className="mb-2 flex items-center justify-between text-xs text-text-faint">
              <span>Sequence · click a clip to trim it · Alt+←/→ to reorder</span>
              <span>{items.length} clips</span>
            </div>
            {items.length ? (
              <ol className="flex gap-1 overflow-x-auto pb-2" aria-label="Sequence">
                {items.map((it, n) => {
                  const m = media[it.referenceId];
                  const d = m?.duration ? trimmedDuration(it, m.duration) : 1;
                  return (
                    <li key={it.id} style={{ width: Math.max(90, d * 28) }} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelected(it.id)}
                        onKeyDown={(e) => {
                          if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                            e.preventDefault();
                            move(it.id, e.key === "ArrowLeft" ? -1 : 1);
                          }
                        }}
                        aria-pressed={selected === it.id}
                        aria-label={`Clip ${n + 1}: ${m?.title ?? "missing"}, ${d.toFixed(1)} seconds`}
                        className={`block w-full overflow-hidden rounded-sm border text-left ${selected === it.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong"}`}
                        data-testid="reel-item"
                      >
                        <div className="h-14 bg-player">
                          {m?.playUrl ? (
                            // The frame at the trim-in point (media fragment), not the reference's poster.
                            <video src={`${m.playUrl}#t=${(it.inSec ?? 0) + 0.05}`} muted preload="metadata" playsInline className="pointer-events-none h-full w-full object-cover" />
                          ) : m?.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                            <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="flex justify-between px-1.5 py-0.5 text-2xs">
                          <span className="truncate text-text-muted">{m?.title}</span>
                          <span className="font-mono text-text-faint">{d.toFixed(1)}s</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-text-muted">Add videos and clips from the panel on the right.</p>
            )}
          </div>

          {/* Trim the selected clip */}
          {sel && selMedia && (
            <div className="grid grid-cols-[320px_1fr] gap-5 border-t border-border p-5" data-testid="trim-panel">
              <div className="overflow-hidden rounded-sm bg-player">
                {selMedia.playUrl ? (
                  <video ref={trimVideo} key={sel.id} src={selMedia.playUrl} controls muted playsInline className="aspect-video w-full" onLoadedMetadata={(e) => (e.currentTarget.currentTime = sel.inSec ?? 0)} />
                ) : (
                  <div className="grid aspect-video place-items-center text-xs text-white/60">Preview after saving…</div>
                )}
              </div>
              <div className="space-y-3">
                <div className="font-medium">{selMedia.title}</div>
                <div className="flex items-end gap-3">
                  <label className="text-xs text-text-muted">
                    In (s)
                    <input type="number" step={0.1} min={0} max={selMedia.duration ?? undefined} value={sel.inSec ?? 0} onChange={(e) => patch(sel.id, { inSec: Number(e.target.value) || 0 })} aria-label="Trim in, seconds" className="mt-1 h-8 w-24 rounded-md border border-border bg-surface-2 px-2 font-mono text-sm text-text" />
                  </label>
                  <label className="text-xs text-text-muted">
                    Out (s)
                    <input type="number" step={0.1} min={0} max={selMedia.duration ?? undefined} value={sel.outSec ?? selMedia.duration ?? 0} onChange={(e) => patch(sel.id, { outSec: Number(e.target.value) || null })} aria-label="Trim out, seconds" className="mt-1 h-8 w-24 rounded-md border border-border bg-surface-2 px-2 font-mono text-sm text-text" />
                  </label>
                  <button type="button" onClick={() => trimVideo.current && patch(sel.id, { inSec: Math.round(trimVideo.current.currentTime * 100) / 100 })} className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-2">
                    In at playhead
                  </button>
                  <button type="button" onClick={() => trimVideo.current && patch(sel.id, { outSec: Math.round(trimVideo.current.currentTime * 100) / 100 })} className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-2">
                    Out at playhead
                  </button>
                </div>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => move(sel.id, -1)} className="h-7 rounded-sm border border-border px-2">
                    ← Earlier
                  </button>
                  <button type="button" onClick={() => move(sel.id, 1)} className="h-7 rounded-sm border border-border px-2">
                    Later →
                  </button>
                  <button type="button" onClick={() => patch(sel.id, { inSec: null, outSec: null })} className="h-7 rounded-sm border border-border px-2">
                    Reset trim
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItems((cur) => cur.filter((i) => i.id !== sel.id));
                      setSelected(null);
                    }}
                    className="ml-auto h-7 rounded-sm px-2 text-danger hover:bg-surface-2"
                  >
                    Remove from reel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col border-l border-border">
          <div className="px-3 pt-3 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Add clips</div>
          <MediaPicker boards={boards} accept={(r) => r.type === "video" || r.type === "clip"} onPick={add} label="Add to reel:" />
        </div>
      </div>
    </div>
  );
}
