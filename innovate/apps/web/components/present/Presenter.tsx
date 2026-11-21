"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlideInput } from "@innovate/shared";
import { type SlideMedia, SlideView } from "./SlideView";

/**
 * Full-screen presentation (SPEC §5.5): arrow keys, Space and PageUp/PageDown step through slides,
 * Esc leaves full screen, GIFs and clips play. The slide number lives in the URL hash (#slide-3),
 * so links into a deck land on the right slide.
 */
export function Presenter({
  title,
  theme,
  slides,
  media,
  onExit,
}: {
  title: string;
  theme: "paper" | "night";
  slides: SlideInput[];
  media: Record<string, SlideMedia | undefined>;
  onExit?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const count = slides.length;

  useEffect(() => {
    const fromHash = () => {
      const n = Number(/^#slide-(\d+)$/.exec(window.location.hash)?.[1]);
      if (n >= 1) setIndex(Math.min(n, count) - 1);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [count]);

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(count - 1, to));
      setIndex(next);
      history.replaceState(null, "", `#slide-${next + 1}`);
    },
    [count],
  );

  const fullscreen = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(count - 1);
      else if (e.key === "f" || e.key === "F") fullscreen();
      else if (e.key === "Escape" && !document.fullscreenElement) onExit?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, go, fullscreen, onExit]);

  const slide = slides[index];
  return (
    <div ref={root} className="group relative flex h-full w-full items-center justify-center bg-black" data-testid="presenter">
      <div className="w-full max-w-[calc((100vh)*16/9)]" onClick={() => go(index + 1)}>
        {slide ? <SlideView key={slide.id} slide={slide} media={media} theme={theme} deckTitle={title} playing /> : null}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-5 py-3 text-sm text-white/70 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide" className="rounded-sm bg-white/10 px-2 py-1 hover:bg-white/20 disabled:opacity-40">
            ←
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index >= count - 1} aria-label="Next slide" className="rounded-sm bg-white/10 px-2 py-1 hover:bg-white/20 disabled:opacity-40">
            →
          </button>
          <span className="font-mono text-xs" data-testid="slide-counter">
            {Math.min(index + 1, count)} / {count}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fullscreen} className="rounded-sm bg-white/10 px-2 py-1 hover:bg-white/20">
            Full screen (F)
          </button>
          {onExit && (
            <button type="button" onClick={onExit} className="rounded-sm bg-white/10 px-2 py-1 hover:bg-white/20">
              Exit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
