"use client";
import * as Slider from "@radix-ui/react-slider";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import {
  estimateGifBytes,
  formatBytes,
  formatDuration,
  formatTimecode,
  type FrameRate,
  GIF_FPS,
  GIF_WIDTHS,
  type GifOptions,
  resolveGifParams,
  fpsValue,
  frameToSeconds,
} from "@innovate/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import type { JobDTO } from "@/lib/media";

export interface RangeInfo {
  inFrame: number;
  outFrame: number;
  auto: boolean;
  autoLabel: string | null;
  hasIn: boolean;
  hasOut: boolean;
}

interface Props {
  fps: FrameRate;
  source: { width: number; height: number; hasAudio: boolean };
  frame: number;
  range: RangeInfo;
  gifCost: { motion: number; density: { first: number; perFrame: number } | null };
  gif: GifOptions;
  onGif(next: GifOptions): void;
  stillFormat: "png" | "jpg";
  onStillFormat(f: "png" | "jpg"): void;
  onExport(kind: "still" | "gif" | "clip"): void;
  onClearIn(): void;
  onClearOut(): void;
  exports: JobDTO[];
  boards: { id: string; title: string }[];
  saveTo: string;
  onSaveTo(id: string): void;
  autoDownload: boolean;
  onAutoDownload(v: boolean): void;
  onSave(job: JobDTO): void;
  onDownload(job: JobDTO): void;
  onRetry(job: JobDTO): void;
}

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">{title}</h3>
        {hint}
      </div>
      {children}
    </section>
  );
}

function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  format = String,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange(v: T): void;
  disabled?: (v: T) => boolean;
  format?: (v: T) => string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={String(value)}
      onValueChange={(v) => {
        const opt = options.find((o) => String(o) === v);
        if (opt !== undefined) onChange(opt);
      }}
      className="flex flex-wrap gap-1"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={String(o)}
          value={String(o)}
          disabled={disabled?.(o)}
          className="h-6 rounded-sm border border-border px-2 font-mono text-xs text-text-muted hover:border-border-strong hover:text-text disabled:opacity-30 data-[state=on]:border-accent-line data-[state=on]:bg-accent-soft data-[state=on]:text-text"
        >
          {format(o)}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

const KIND_LABEL = { still: "Still", gif: "GIF", clip: "Clip" } as const;

export function Inspector(p: Props) {
  const frames = p.range.outFrame - p.range.inFrame + 1;
  const seconds = frameToSeconds(frames, p.fps);
  const gifParams = resolveGifParams(p.gif, { width: p.source.width, height: p.source.height, fps: fpsValue(p.fps) }, seconds);
  const estimate = estimateGifBytes(gifParams, p.gifCost);
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-border bg-surface" aria-label="Export">
      <Section
        title="Range"
        hint={p.range.auto && p.range.autoLabel ? <span className="text-2xs text-text-faint">Auto · {p.range.autoLabel}</span> : null}
      >
        <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-text-faint">In</dt>
          <dd className="timecode" data-testid="in-tc">
            {formatTimecode(p.range.inFrame, p.fps)}
          </dd>
          <dd>
            {p.range.hasIn ? (
              <button type="button" onClick={p.onClearIn} className="text-2xs text-text-faint hover:text-text" aria-label="Clear in point">
                Clear
              </button>
            ) : (
              <Kbd>I</Kbd>
            )}
          </dd>
          <dt className="text-text-faint">Out</dt>
          <dd className="timecode" data-testid="out-tc">
            {formatTimecode(p.range.outFrame, p.fps)}
          </dd>
          <dd>
            {p.range.hasOut ? (
              <button type="button" onClick={p.onClearOut} className="text-2xs text-text-faint hover:text-text" aria-label="Clear out point">
                Clear
              </button>
            ) : (
              <Kbd>O</Kbd>
            )}
          </dd>
          <dt className="text-text-faint">Dur</dt>
          <dd className="timecode col-span-2" data-testid="dur">
            {formatTimecode(frames, p.fps)} <span className="text-text-faint">· {formatDuration(frames, p.fps)} · {frames} fr</span>
          </dd>
        </dl>
      </Section>

      <Section title="Still" hint={<Kbd>S</Kbd>}>
        <div className="flex items-center justify-between gap-2">
          <Chips label="Still format" value={p.stillFormat} options={["png", "jpg"] as const} onChange={p.onStillFormat} format={(v) => v.toUpperCase()} />
          <Button size="sm" onClick={() => p.onExport("still")}>
            Grab frame
          </Button>
        </div>
        <p className="mt-2 text-xs text-text-faint">
          <span className="timecode">{formatTimecode(p.frame, p.fps)}</span> · {p.source.width}×{p.source.height}, full resolution
        </p>
      </Section>

      <Section title="GIF" hint={<Kbd>G</Kbd>}>
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 text-xs text-text-faint">Width</div>
            <Chips
              label="GIF width"
              value={p.gif.width}
              options={GIF_WIDTHS}
              onChange={(width) => p.onGif({ ...p.gif, width })}
              disabled={(w) => w > p.source.width && w !== GIF_WIDTHS[0]}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-faint">Frame rate</div>
            <Chips label="GIF frame rate" value={p.gif.fps} options={GIF_FPS} onChange={(fps) => p.onGif({ ...p.gif, fps })} />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-faint">Playback</div>
            <Chips
              label="GIF playback"
              value={p.gif.loop}
              options={["loop", "boomerang"] as const}
              onChange={(loop) => p.onGif({ ...p.gif, loop })}
              format={(v) => (v === "loop" ? "Loop" : "Boomerang")}
            />
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-text-faint">
              <span>Smaller</span>
              <span>Quality {p.gif.quality}</span>
              <span>Sharper</span>
            </div>
            <Slider.Root
              value={[p.gif.quality]}
              min={0}
              max={100}
              step={5}
              onValueChange={([q]) => p.onGif({ ...p.gif, quality: q ?? p.gif.quality })}
              className="relative flex h-4 w-full touch-none items-center"
              aria-label="GIF quality"
            >
              <Slider.Track className="relative h-[3px] grow rounded-full bg-surface-4">
                <Slider.Range className="absolute h-full rounded-full bg-accent" />
              </Slider.Track>
              <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-surface-2" aria-label="GIF quality" />
            </Slider.Root>
          </div>
          <div className="flex items-end justify-between gap-2 pt-1">
            <div className="text-xs leading-5" data-testid="gif-estimate">
              <div className="text-md text-text tabular" title={p.gifCost.density ? "Measured from a sample of this footage" : "Rough guess"}>
                ≈ {formatBytes(estimate)}
              </div>
              <div className="text-text-faint tabular">
                {gifParams.width}×{gifParams.height} · {gifParams.frames} frames · {gifParams.maxColors} colours
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => p.onExport("gif")}>
              Make GIF
            </Button>
          </div>
          <p className="text-xs leading-[17px] text-text-faint italic">
            Some references only work in motion: a camera move, a transition, a feeling a still can&apos;t hold.
          </p>
        </div>
      </Section>

      <Section title="Clip" hint={<Kbd>C</Kbd>}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-faint">
            MP4 · H.264{p.source.hasAudio ? " + AAC" : ""} · {p.source.width - (p.source.width % 2)}×{p.source.height - (p.source.height % 2)}
            {!p.source.hasAudio && <span className="block">The source has no sound.</span>}
          </p>
          <Button size="sm" onClick={() => p.onExport("clip")}>
            Export clip
          </Button>
        </div>
      </Section>

      <section className="flex-1 px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">Exports</h3>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="checkbox" checked={p.autoDownload} onChange={(e) => p.onAutoDownload(e.target.checked)} className="accent-[var(--in-accent)]" />
            Download when ready
          </label>
        </div>
        <label className="mb-2.5 flex items-center gap-2 text-xs text-text-muted">
          <span className="shrink-0">
            Save to <span className="text-text-faint">(Enter)</span>
          </span>
          <select
            value={p.saveTo}
            onChange={(e) => p.onSaveTo(e.target.value)}
            className="h-6 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-2 px-1.5 text-xs text-text"
            aria-label="Save exports to"
            data-testid="save-to"
          >
            <option value="">Unsorted</option>
            {p.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        {p.exports.length === 0 ? (
          <p className="text-xs leading-5 text-text-faint">
            Nothing yet. Press <Kbd>S</Kbd>, <Kbd>G</Kbd> or <Kbd>C</Kbd>, then <Kbd>Enter</Kbd> to keep the latest in your library.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="exports">
            {p.exports.map((job) => (
              <ExportRow key={job.id} job={job} onSave={p.onSave} onDownload={p.onDownload} onRetry={p.onRetry} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  downloading: "Preparing source",
  palette: "Building palette",
  encoding: "Encoding",
  uploading: "Finishing",
};

function ExportRow({ job, onSave, onDownload, onRetry }: { job: JobDTO; onSave(j: JobDTO): void; onDownload(j: JobDTO): void; onRetry(j: JobDTO): void }) {
  const kind = job.kind ?? "still";
  const done = job.status === "completed" && job.output;
  return (
    <li className="rounded-md border border-border bg-surface-2 p-2" data-testid="export-row" data-status={job.status} data-kind={kind} data-job={job.id}>
      <div className="flex items-center gap-2.5">
        <div className="relative grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-sm bg-player">
          {done && job.previewUrl && kind !== "clip" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.previewUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-2xs font-medium text-white/50">{KIND_LABEL[kind]}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs" title={job.output?.filename}>
            {job.output?.filename ?? `${KIND_LABEL[kind]} export`}
          </div>
          {job.status === "failed" ? (
            <div className="text-2xs text-danger" role="alert">
              {job.error ?? "Export failed"}
            </div>
          ) : done ? (
            <div className="text-2xs text-text-faint tabular">
              {formatBytes(job.output!.bytes)} · {job.output!.width}×{job.output!.height}
              {job.savedReferenceId && <span className="ml-1 text-success">· In library</span>}
            </div>
          ) : (
            <div className="mt-1">
              <div className="h-[3px] overflow-hidden rounded-full bg-surface-4">
                <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(4, job.progress)}%` }} />
              </div>
              <div className="mt-0.5 text-2xs text-text-faint">{STAGE_LABEL[job.stage] ?? "Working"}…</div>
            </div>
          )}
        </div>
      </div>
      {(done || job.status === "failed") && (
        <div className="mt-2 flex justify-end gap-1.5">
          {job.status === "failed" ? (
            <Button size="sm" variant="ghost" onClick={() => onRetry(job)}>
              Retry
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onDownload(job)}>
                Download
              </Button>
              <Button size="sm" variant="ghost" disabled={Boolean(job.savedReferenceId)} onClick={() => onSave(job)}>
                {job.savedReferenceId ? "Saved" : "Save"}
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
