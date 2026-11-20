"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GIF_OPTIONS, formatTimecode, type GifOptions, nominalFps } from "@innovate/shared";
import { useShortcutsOverlay } from "@/components/shell/ShortcutsOverlay";
import { Kbd } from "@/components/ui/Kbd";
import { useToast } from "@/components/ui/Toasts";
import type { JobDTO, ReferenceDTO } from "@/lib/media";
import { actionFor, type ShortcutAction } from "@/lib/shortcuts";
import { Inspector } from "./Inspector";
import { IngestView } from "./IngestView";
import { SceneList } from "./SceneList";
import { Timeline, type TimelineHandle } from "./Timeline";
import { usePlayer } from "./usePlayer";

const PREFS_KEY = "innovate.editor.prefs";

function loadPrefs(): { gif: GifOptions; stillFormat: "png" | "jpg"; autoDownload: boolean } {
  const fallback = { gif: DEFAULT_GIF_OPTIONS, stillFormat: "png" as const, autoDownload: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Which keys a focused control keeps for itself (buttons via keyboard keep Space/Enter, etc.). */
function controlOwnsKey(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
    return !(t instanceof HTMLInputElement && t.type === "checkbox" && e.code !== "Space");
  }
  const role = t.getAttribute("role");
  const nav = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key);
  if (role === "slider" || role === "radio") return nav || e.code === "Space" || e.key === "Enter";
  if ((t.tagName === "BUTTON" || t.tagName === "A") && (e.code === "Space" || e.key === "Enter")) return t.matches(":focus-visible");
  return false;
}

export function Editor({ initial }: { initial: ReferenceDTO }) {
  const [ref, setRef] = useState(initial);
  const toast = useToast();
  const overlay = useShortcutsOverlay();
  const ready = ref.status === "ready" && ref.fps && ref.proxyUrl;
  const fps = useMemo(() => ref.fps ?? { num: 25, den: 1 }, [ref.fps]);
  const frameCount = Math.max(1, ref.frameCount ?? 1);
  const last = frameCount - 1;
  const { videoRef, frame, seek, step, shuttle, playing, stop, togglePlay, shuttleForward, shuttleBack } = usePlayer({
    fps: ref.fps,
    frameCount,
  });
  const timeline = useRef<TimelineHandle>(null);

  const [inMark, setInMark] = useState<number | null>(null);
  const [outMark, setOutMark] = useState<number | null>(null);
  const [prefs, setPrefs] = useState(() => (typeof window === "undefined" ? { gif: DEFAULT_GIF_OPTIONS, stillFormat: "png" as const, autoDownload: true } : loadPrefs()));
  const [exports, setExports] = useState<JobDTO[]>([]);
  const [muted, setMuted] = useState(false);
  const [zoomInfo, setZoomInfo] = useState({ zoom: 1, max: 1 });
  const downloaded = useRef(new Set<string>());
  const wasPlaying = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }, [prefs]);

  // Poll the reference until ingest finishes.
  useEffect(() => {
    if (ready || ref.status === "failed") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/references/${ref.id}`);
      if (res.ok) setRef((await res.json()).reference);
    }, 700);
    return () => clearInterval(t);
  }, [ready, ref.id, ref.status]);

  const scenes = ref.scenes;
  const sceneAt = useCallback((f: number) => scenes.find((s) => f >= s.startFrame && f < s.endFrame) ?? null, [scenes]);

  // Effective range: explicit marks, else the scene under the playhead.
  const range = useMemo(() => {
    const scene = sceneAt(frame);
    const auto = inMark === null && outMark === null;
    const inFrame = inMark ?? (outMark !== null ? 0 : (scene?.startFrame ?? 0));
    const outFrame = outMark ?? (inMark !== null ? last : scene ? scene.endFrame - 1 : last);
    return {
      inFrame,
      outFrame: Math.max(inFrame, outFrame),
      auto,
      autoLabel: auto && scene ? `scene ${String(scene.index + 1).padStart(2, "0")}` : null,
      hasIn: inMark !== null,
      hasOut: outMark !== null,
    };
  }, [frame, inMark, outMark, last, sceneAt]);

  // Frame-weighted density/motion of the scenes the range covers, for the GIF size estimate.
  const gifCost = useMemo(() => {
    let frames = 0;
    let first = 0;
    let perFrame = 0;
    let densityFrames = 0;
    let motion = 0;
    for (const s of scenes) {
      const overlap = Math.min(s.endFrame, range.outFrame + 1) - Math.max(s.startFrame, range.inFrame);
      if (overlap <= 0) continue;
      frames += overlap;
      motion += s.motion * overlap;
      if (s.gifDensity) {
        first += s.gifDensity.first * overlap;
        perFrame += s.gifDensity.perFrame * overlap;
        densityFrames += overlap;
      }
    }
    return {
      motion: frames ? motion / frames : 6,
      density: densityFrames ? { first: first / densityFrames, perFrame: perFrame / densityFrames } : null,
    };
  }, [scenes, range]);

  // Export jobs: poll the active ones.
  const upsertExport = useCallback((job: JobDTO) => {
    setExports((list) => [job, ...list.filter((j) => j.id !== job.id)]);
  }, []);
  const active = exports.filter((j) => j.status === "queued" || j.status === "active").map((j) => j.id).join(",");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      for (const id of active.split(",")) {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) continue;
        const { job } = (await res.json()) as { job: JobDTO };
        setExports((list) => list.map((j) => (j.id === job.id ? job : j)));
      }
    }, 450);
    return () => clearInterval(t);
  }, [active]);

  // Announce + auto-download finished exports once.
  useEffect(() => {
    for (const job of exports) {
      if (job.status === "completed" && job.downloadUrl && job.output && !downloaded.current.has(job.id)) {
        downloaded.current.add(job.id);
        toast(`${job.kind === "gif" ? "GIF" : job.kind === "clip" ? "Clip" : "Still"} ready · ${job.output.filename}`, "success");
        if (prefs.autoDownload) triggerDownload(job.downloadUrl, job.output.filename);
      }
      if (job.status === "failed" && !downloaded.current.has(`fail:${job.id}`)) {
        downloaded.current.add(`fail:${job.id}`);
        toast(job.error ?? "Export failed", "error");
      }
    }
  }, [exports, prefs.autoDownload, toast]);

  const startExport = useCallback(
    async (kind: "still" | "gif" | "clip") => {
      if (!ready) return;
      const body =
        kind === "still"
          ? { kind, referenceId: ref.id, frame, format: prefs.stillFormat }
          : kind === "gif"
            ? { kind, referenceId: ref.id, inFrame: range.inFrame, outFrame: range.outFrame, options: prefs.gif }
            : { kind, referenceId: ref.id, inFrame: range.inFrame, outFrame: range.outFrame };
      try {
        const { job } = await postJson<{ job: JobDTO }>("/api/exports", body);
        // Re-requesting an identical export returns the same job; download it again.
        if (job.status === "completed") downloaded.current.delete(job.id);
        upsertExport(job);
        if (job.status !== "completed")
          toast(kind === "still" ? `Grabbing ${formatTimecode(frame, fps)}` : `Rendering ${kind === "gif" ? "GIF" : "clip"} ${formatTimecode(range.inFrame, fps)} → ${formatTimecode(range.outFrame, fps)}`);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    },
    [fps, frame, prefs.gif, prefs.stillFormat, range, ready, ref.id, toast, upsertExport],
  );

  // Saves in flight, so a quick Enter after a click doesn't pick the same export twice.
  const saving = useRef(new Set<string>());
  const saveExport = useCallback(
    async (job?: JobDTO) => {
      const target =
        job ?? exports.find((j) => j.status === "completed" && !j.savedReferenceId && !saving.current.has(j.id));
      if (!target) {
        toast(exports.some((j) => j.savedReferenceId) ? "Your latest exports are already in the library." : "Export something first: S, G or C.");
        return;
      }
      if (saving.current.has(target.id)) return;
      saving.current.add(target.id);
      try {
        const { referenceId, alreadySaved } = await postJson<{ referenceId: string; alreadySaved: boolean }>(`/api/jobs/${target.id}/save`);
        setExports((list) => list.map((j) => (j.id === target.id ? { ...j, savedReferenceId: referenceId } : j)));
        toast(alreadySaved ? "Already in your library" : `Saved ${target.output?.filename ?? "export"} to your library`, "success");
      } catch (err) {
        toast((err as Error).message, "error");
      } finally {
        saving.current.delete(target.id);
      }
    },
    [exports, toast],
  );

  const pickScene = useCallback(
    (s: { startFrame: number; endFrame: number }) => {
      stop();
      setInMark(s.startFrame);
      setOutMark(s.endFrame - 1);
      seek(s.startFrame);
    },
    [seek, stop],
  );

  const onZoomChange = useCallback(
    (zoom: number, max: number) => setZoomInfo((z) => (z.zoom === zoom && z.max === max ? z : { zoom, max })),
    [],
  );

  const cuts = useMemo(() => scenes.map((s) => s.startFrame).filter((f) => f > 0), [scenes]);

  const run = useCallback(
    (action: ShortcutAction) => {
      const second = nominalFps(fps);
      switch (action) {
        case "playPause":
          return togglePlay();
        case "shuttleBack":
          return shuttleBack();
        case "stop":
          return stop();
        case "shuttleForward":
          return shuttleForward();
        case "stepBack":
          return step(-1);
        case "stepForward":
          return step(1);
        case "stepBackSecond":
          return step(-second);
        case "stepForwardSecond":
          return step(second);
        case "home":
          return step(-frame);
        case "end":
          return step(last - frame);
        case "markIn":
          setInMark(frame);
          if (outMark !== null && outMark < frame) setOutMark(null);
          return;
        case "markOut":
          setOutMark(frame);
          if (inMark !== null && inMark > frame) setInMark(null);
          return;
        case "clearIn":
          return setInMark(null);
        case "clearOut":
          return setOutMark(null);
        case "prevCut": {
          const prev = [0, ...cuts].filter((c) => c < frame).pop();
          return step((prev ?? 0) - frame);
        }
        case "nextCut": {
          const next = cuts.find((c) => c > frame);
          return step((next ?? last) - frame);
        }
        case "still":
        case "gif":
        case "clip":
          return void startExport(action);
        case "save":
          return void saveExport();
        case "zoomIn":
          return timeline.current?.zoomBy(1.6);
        case "zoomOut":
          return timeline.current?.zoomBy(1 / 1.6);
        case "help":
          return; // handled by the overlay provider
      }
    },
    [cuts, fps, frame, inMark, last, outMark, saveExport, shuttleBack, shuttleForward, startExport, step, stop, togglePlay],
  );

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (overlay.open || e.defaultPrevented || controlOwnsKey(e)) return;
      const action = actionFor(e);
      if (!action || action === "help") return;
      e.preventDefault();
      run(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay.open, ready, run]);

  const aspect = ref.width && ref.height ? ref.width / ref.height : 16 / 9;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4 text-sm">
        <Link href="/make" className="text-text-faint hover:text-text" aria-label="Back to GIF Maker">
          ←
        </Link>
        <h1 className="min-w-0 truncate font-medium" data-testid="ref-title">
          {ref.title}
        </h1>
        {ready && (
          <span className="truncate text-xs text-text-faint tabular">
            {ref.width}×{ref.height} · {(fps.num / fps.den).toFixed(fps.den === 1 ? 0 : 3)} fps · {formatTimecode(frameCount, fps)}
            {ref.hasAudio ? " · audio" : " · no audio"}
          </span>
        )}
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-text-faint lg:flex">
          Press <Kbd>?</Kbd> for shortcuts
        </span>
      </div>

      {!ready ? (
        <div className="min-h-0 flex-1">
          <IngestView
            reference={ref}
            onRetry={async () => {
              try {
                await postJson(`/api/references/${ref.id}/ingest`);
                setRef({ ...ref, status: "processing", error: null, ingest: ref.ingest ? { ...ref.ingest, status: "queued", error: null } : null });
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,264px)_minmax(0,1fr)_minmax(280px,312px)]">
          <SceneList scenes={scenes} fps={fps} aspect={aspect} currentFrame={frame} onPick={pickScene} />

          <main className="flex min-h-0 min-w-0 flex-col bg-bg" data-testid="editor">
            <div className="relative min-h-0 flex-1 bg-player">
              <video
                ref={videoRef}
                src={ref.proxyUrl ?? undefined}
                preload="auto"
                muted={muted}
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
                data-testid="player"
                onClick={togglePlay}
                aria-label={`${ref.title} preview`}
              />
              <div className="pointer-events-none absolute top-3 left-3 rounded-sm bg-black/55 px-1.5 py-0.5 timecode text-xs text-white/90" aria-hidden="true">
                {formatTimecode(frame, fps)}
              </div>
            </div>

            <Transport
              frame={frame}
              fps={fps}
              frameCount={frameCount}
              shuttle={shuttle}
              muted={muted}
              hasAudio={ref.hasAudio}
              onToggleMute={() => setMuted((m) => !m)}
              run={run}
              zoom={zoomInfo}
            />

            <div className="shrink-0 border-t border-border bg-surface px-0 pt-1">
              <Timeline
                ref={timeline}
                fps={fps}
                frameCount={frameCount}
                frame={frame}
                range={range}
                scenes={scenes}
                filmstrip={ref.filmstrip}
                aspect={aspect}
                onSeek={seek}
                onScrub={(on) => {
                  if (on) {
                    wasPlaying.current = playing;
                    stop();
                  }
                }}
                onRangeChange={(i, o) => {
                  setInMark(i);
                  setOutMark(o);
                }}
                onZoomChange={onZoomChange}
              />
            </div>
          </main>

          <Inspector
            fps={fps}
            source={{ width: ref.width ?? 0, height: ref.height ?? 0, hasAudio: ref.hasAudio }}
            frame={frame}
            range={range}
            gifCost={gifCost}
            gif={prefs.gif}
            onGif={(gif) => setPrefs((p) => ({ ...p, gif }))}
            stillFormat={prefs.stillFormat}
            onStillFormat={(stillFormat) => setPrefs((p) => ({ ...p, stillFormat }))}
            onExport={(k) => void startExport(k)}
            onClearIn={() => setInMark(null)}
            onClearOut={() => setOutMark(null)}
            exports={exports}
            autoDownload={prefs.autoDownload}
            onAutoDownload={(autoDownload) => setPrefs((p) => ({ ...p, autoDownload }))}
            onSave={(j) => void saveExport(j)}
            onDownload={(j) => j.downloadUrl && j.output && triggerDownload(j.downloadUrl, j.output.filename)}
            onRetry={async (j) => {
              if (!j.request) return;
              try {
                const { job } = await postJson<{ job: JobDTO }>("/api/exports", j.request);
                downloaded.current.delete(`fail:${job.id}`);
                upsertExport(job);
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function IconButton({ label, keys, onClick, children, active }: { label: string; keys?: string; onClick(): void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseUp={(e) => e.currentTarget.blur()}
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      className={`grid h-7 w-7 place-items-center rounded-md ${active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-3 hover:text-text"}`}
    >
      {children}
    </button>
  );
}

const icon = (d: string) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);

function Transport({
  frame,
  fps,
  frameCount,
  shuttle,
  muted,
  hasAudio,
  onToggleMute,
  run,
  zoom,
}: {
  frame: number;
  fps: { num: number; den: number };
  frameCount: number;
  shuttle: number;
  muted: boolean;
  hasAudio: boolean;
  onToggleMute(): void;
  run(a: ShortcutAction): void;
  zoom: { zoom: number; max: number };
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border bg-surface px-3">
      <div className="flex items-baseline gap-1.5">
        <span className="timecode text-md text-text" data-testid="current-tc">
          {formatTimecode(frame, fps)}
        </span>
        <span className="timecode text-xs text-text-faint">/ {formatTimecode(frameCount, fps)}</span>
      </div>
      <div className="mx-auto flex items-center gap-0.5">
        <IconButton label="Previous cut" keys="[" onClick={() => run("prevCut")}>
          {icon("M3 3h1.5v10H3zM13 3v10L5.5 8z")}
        </IconButton>
        <IconButton label="Back one frame" keys="←" onClick={() => run("stepBack")}>
          {icon("M11 3v10L4 8z")}
        </IconButton>
        <IconButton label={shuttle ? "Pause" : "Play"} keys="Space" onClick={() => run("playPause")} active={shuttle !== 0}>
          {shuttle ? icon("M4 3h3v10H4zM9 3h3v10H9z") : icon("M4 2.5v11L13 8z")}
        </IconButton>
        <IconButton label="Forward one frame" keys="→" onClick={() => run("stepForward")}>
          {icon("M5 3v10l7-5z")}
        </IconButton>
        <IconButton label="Next cut" keys="]" onClick={() => run("nextCut")}>
          {icon("M3 3v10l7.5-5zM11.5 3H13v10h-1.5z")}
        </IconButton>
        <span className="ml-2 w-12 font-mono text-xs text-accent tabular" aria-live="polite" data-testid="shuttle">
          {shuttle === 0 || shuttle === 1 ? "" : `${shuttle < 0 ? "◀◀" : "▶▶"} ${Math.abs(shuttle)}×`}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        {hasAudio && (
          <IconButton label={muted ? "Unmute preview" : "Mute preview"} onClick={onToggleMute}>
            {muted ? icon("M2 6h3l4-3v10L5 10H2zM11 6l4 4M15 6l-4 4") : icon("M2 6h3l4-3v10L5 10H2zM11 5.5a3.5 3.5 0 0 1 0 5")}
          </IconButton>
        )}
        <IconButton label="Zoom timeline out" keys="-" onClick={() => run("zoomOut")}>
          {icon("M3 7.25h10v1.5H3z")}
        </IconButton>
        <span className="w-10 text-center font-mono text-2xs text-text-faint tabular">{zoom.zoom < 10 ? zoom.zoom.toFixed(1) : Math.round(zoom.zoom)}×</span>
        <IconButton label="Zoom timeline in" keys="=" onClick={() => run("zoomIn")}>
          {icon("M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z")}
        </IconButton>
      </div>
    </div>
  );
}
