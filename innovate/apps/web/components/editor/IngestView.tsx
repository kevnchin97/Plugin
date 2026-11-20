"use client";
import type { ReferenceDTO } from "@/lib/media";
import { Button } from "@/components/ui/Button";

const STEPS: { stage: string[]; label: string }[] = [
  { stage: ["uploading", "fetching"], label: "Fetching the video" },
  { stage: ["probing", "proxy"], label: "Creating a scrubbing proxy" },
  { stage: ["filmstrip"], label: "Building the filmstrip" },
  { stage: ["scenes"], label: "Detecting scenes" },
];

export function IngestView({ reference, onRetry }: { reference: ReferenceDTO; onRetry(): void }) {
  const stage = reference.ingest?.stage && reference.ingest.stage !== "queued" ? reference.ingest.stage : (reference.stage ?? "uploading");
  const current = Math.max(0, STEPS.findIndex((s) => s.stage.includes(stage)));
  const failed = reference.status === "failed" || reference.ingest?.status === "failed";
  const progress = reference.ingest?.progress ?? 0;
  return (
    <div className="grid h-full place-items-center bg-player px-6" data-testid="ingest">
      <div className="w-full max-w-[380px]">
        <p className="truncate text-lg font-medium text-white">{reference.title}</p>
        <ol className="mt-6 space-y-3" aria-label="Processing steps">
          {STEPS.map((s, i) => {
            const state = failed && i === current ? "failed" : i < current ? "done" : i === current ? "active" : "todo";
            return (
              <li key={s.label} className="flex items-center gap-3 text-sm" data-state={state}>
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-2xs ${
                    state === "done"
                      ? "border-success/60 text-success"
                      : state === "active"
                        ? "border-accent text-accent"
                        : state === "failed"
                          ? "border-danger text-danger"
                          : "border-white/15 text-white/30"
                  }`}
                  aria-hidden="true"
                >
                  {state === "done" ? "✓" : state === "failed" ? "!" : i + 1}
                </span>
                <span className={state === "todo" ? "text-white/35" : "text-white/85"}>{s.label}</span>
                {state === "active" && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
              </li>
            );
          })}
        </ol>
        {!failed && (
          <div className="mt-6 h-[3px] overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(3, progress)}%` }} />
          </div>
        )}
        {failed && (
          <div role="alert" className="mt-6 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <p>{reference.error ?? reference.ingest?.error ?? "Processing failed."}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
