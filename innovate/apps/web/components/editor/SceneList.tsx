"use client";
import { useState } from "react";
import { type FrameRate, formatDuration, formatTimecode } from "@innovate/shared";
import type { ReferenceDTO } from "@/lib/media";

type Scene = ReferenceDTO["scenes"][number];

export function SceneList({
  scenes,
  fps,
  aspect,
  currentFrame,
  onPick,
}: {
  scenes: Scene[];
  fps: FrameRate;
  aspect: number;
  currentFrame: number;
  onPick(scene: Scene): void;
}) {
  const [order, setOrder] = useState<"best" | "time">("best");
  const sorted = order === "best" ? [...scenes].sort((a, b) => a.rank - b.rank) : scenes;
  const maxScore = Math.max(0.001, ...scenes.map((s) => s.score));
  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-surface" aria-label="Scenes">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-medium">
          Scenes <span className="ml-1 text-text-faint tabular">{scenes.length}</span>
        </h2>
        <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Sort scenes">
          {(["best", "time"] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={order === o}
              onClick={() => setOrder(o)}
              className={`rounded-sm px-2 py-0.5 ${order === o ? "bg-surface-4 text-text" : "text-text-muted hover:text-text"}`}
            >
              {o === "best" ? "Best first" : "In order"}
            </button>
          ))}
        </div>
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" data-testid="scene-list">
        {sorted.map((s) => {
          const active = currentFrame >= s.startFrame && currentFrame < s.endFrame;
          return (
            <li key={s.index}>
              <button
                type="button"
                onClick={() => onPick(s)}
                aria-current={active ? "true" : undefined}
                data-testid="scene"
                className={`group flex w-full gap-2.5 rounded-md p-1.5 text-left transition-colors ${
                  active ? "bg-surface-3 ring-1 ring-accent-line" : "hover:bg-surface-2"
                }`}
              >
                <div className="relative w-[112px] shrink-0 overflow-hidden rounded-sm bg-player" style={{ aspectRatio: aspect }}>
                  {s.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                  )}
                  <span className="absolute right-1 bottom-1 rounded-xs bg-black/70 px-1 font-mono text-2xs text-white/90">
                    {formatDuration(s.endFrame - s.startFrame, fps)}
                  </span>
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">Scene {String(s.index + 1).padStart(2, "0")}</span>
                    {s.rank === 0 && scenes.length > 1 && (
                      <span className="rounded-xs bg-accent-soft px-1 text-2xs font-medium text-accent">Best</span>
                    )}
                  </div>
                  <div className="mt-0.5 timecode text-xs text-text-faint">{formatTimecode(s.startFrame, fps)}</div>
                  <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-4" title={`Worth saving: ${Math.round(s.score * 100)}`}>
                    <div className="h-full rounded-full bg-accent/80" style={{ width: `${(s.score / maxScore) * 100}%` }} />
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-border px-3 py-2 text-2xs leading-4 text-text-faint">
        Ranked by motion, contrast and length. Click a scene to set in and out to its bounds.
      </p>
    </aside>
  );
}
