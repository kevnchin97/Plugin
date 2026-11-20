"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { type FilmstripInfo, type FrameRate, formatTimecode, frameToSeconds, nominalFps } from "@innovate/shared";

export interface TimelineScene {
  index: number;
  startFrame: number;
  endFrame: number;
}

export interface TimelineHandle {
  zoomBy(factor: number, anchorFrame?: number): void;
}

interface Props {
  fps: FrameRate;
  frameCount: number;
  frame: number;
  range: { inFrame: number; outFrame: number; auto: boolean };
  scenes: TimelineScene[];
  filmstrip: (FilmstripInfo & { url: string | null }) | null;
  aspect: number;
  onSeek(frame: number): void;
  onScrub(active: boolean): void;
  onRangeChange(inFrame: number, outFrame: number): void;
  onZoomChange?(zoom: number, max: number): void;
}

const RULER_H = 22;
const STRIP_H = 64;
const PAD_B = 10;
const HEIGHT = RULER_H + STRIP_H + PAD_B;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** Pick a ruler step (in frames) so labels sit at least ~90px apart. */
function rulerStep(ppf: number, fps: FrameRate) {
  const base = nominalFps(fps);
  const frameSteps = [1, 2, 5, 10];
  const secondSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const candidates = [...frameSteps.filter((f) => f < base), ...secondSteps.map((s) => s * base)];
  return candidates.find((c) => c * ppf >= 90) ?? candidates[candidates.length - 1]!;
}

function shortTc(frame: number, fps: FrameRate) {
  const tc = formatTimecode(frame, fps);
  return tc.startsWith("00:") ? tc.slice(3) : tc;
}

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline(props, ref) {
  const { fps, frameCount, frame, range, scenes, filmstrip, aspect, onSeek, onScrub, onRangeChange, onZoomChange } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null);
  const drag = useRef<null | { kind: "seek" | "in" | "out" }>(null);

  const total = Math.max(1, frameCount);
  const maxZoom = Math.max(1, (14 * total) / Math.max(1, width));
  const contentW = width * zoom;
  const ppf = contentW / total;
  const x = (f: number) => f * ppf;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => onZoomChange?.(zoom, maxZoom), [zoom, maxZoom, onZoomChange]);

  useEffect(() => {
    if (!filmstrip?.url) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => setSprite(img);
    img.src = filmstrip.url;
  }, [filmstrip?.url]);

  const zoomBy = useCallback(
    (factor: number, anchorFrame?: number) => {
      const el = scroller.current;
      if (!el || !width) return;
      const next = Math.min(maxZoom, Math.max(1, zoom * factor));
      const anchor = anchorFrame ?? frame;
      const anchorScreen = x(anchor) - el.scrollLeft;
      const nextPpf = (width * next) / total;
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, anchor * nextPpf - anchorScreen);
        setScrollLeft(el.scrollLeft);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, maxZoom, total, width, zoom],
  );
  useImperativeHandle(ref, () => ({ zoomBy }), [zoomBy]);

  // Keep the playhead in view (page forward/back like an NLE).
  useEffect(() => {
    const el = scroller.current;
    if (!el || drag.current) return;
    const px = x(frame);
    if (px < el.scrollLeft || px > el.scrollLeft + width - 8) {
      el.scrollLeft = Math.max(0, px - width * 0.15);
      setScrollLeft(el.scrollLeft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, zoom, width]);

  // Wheel: Ctrl/Cmd zooms around the pointer; plain wheel scrolls horizontally when zoomed.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const anchor = (e.clientX - rect.left + el.scrollLeft) / ppf;
        zoomBy(Math.exp(-e.deltaY * 0.0025), anchor);
      } else if (zoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ppf, zoom, zoomBy]);

  // Draw ruler + filmstrip for the visible window only.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const colors = {
      text: cssVar("--in-text-faint"),
      tick: cssVar("--in-border-strong"),
      strip: cssVar("--in-surface-3"),
      cut: "rgba(255,255,255,0.85)",
    };

    // Ruler.
    const step = rulerStep(ppf, fps);
    const minor = step / 5 >= 1 ? step / 5 : step;
    const first = Math.floor(scrollLeft / ppf / minor) * minor;
    ctx.font = `10px ${cssVar("--font-jetbrains")}, ui-monospace, monospace`;
    ctx.textBaseline = "top";
    for (let f = first; f <= (scrollLeft + width) / ppf; f += minor) {
      const px = Math.round(x(f) - scrollLeft) + 0.5;
      const major = Math.round(f) % step === 0;
      ctx.fillStyle = colors.tick;
      ctx.fillRect(px, major ? RULER_H - 9 : RULER_H - 5, 1, major ? 9 : 5);
      if (major) {
        ctx.fillStyle = colors.text;
        ctx.fillText(shortTc(Math.round(f), fps), px + 4, 4);
      }
    }

    // Filmstrip: tiles at native aspect, each showing the sprite tile nearest its start time.
    const top = RULER_H;
    ctx.fillStyle = colors.strip;
    ctx.fillRect(0, top, Math.min(width, contentW - scrollLeft), STRIP_H);
    if (sprite && filmstrip) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const tw = STRIP_H * aspect;
      const k0 = Math.floor(scrollLeft / tw);
      const k1 = Math.ceil((scrollLeft + width) / tw);
      for (let k = k0; k <= k1; k++) {
        const left = k * tw;
        if (left >= contentW) break;
        const t = frameToSeconds(left / ppf, fps);
        const idx = Math.min(filmstrip.count - 1, Math.max(0, Math.floor(t / filmstrip.interval + 0.5)));
        const sx = (idx % filmstrip.columns) * filmstrip.tileWidth;
        const sy = Math.floor(idx / filmstrip.columns) * filmstrip.tileHeight;
        const drawW = Math.min(tw, contentW - left);
        ctx.drawImage(
          sprite,
          sx,
          sy,
          (filmstrip.tileWidth * drawW) / tw,
          filmstrip.tileHeight,
          left - scrollLeft,
          top,
          drawW,
          STRIP_H,
        );
      }
      // Hairline between tiles keeps the strip readable.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (let k = k0; k <= k1; k++) ctx.fillRect(Math.round(k * tw - scrollLeft), top, 1, STRIP_H);
    }

    // Cuts.
    for (const s of scenes) {
      if (s.startFrame === 0) continue;
      const px = Math.round(x(s.startFrame) - scrollLeft);
      if (px < -2 || px > width + 2) continue;
      ctx.fillStyle = colors.cut;
      ctx.fillRect(px - 1, top, 2, STRIP_H);
      ctx.beginPath();
      ctx.moveTo(px - 4, top);
      ctx.lineTo(px + 4, top);
      ctx.lineTo(px, top + 5);
      ctx.fill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, zoom, scrollLeft, sprite, filmstrip, scenes, fps, aspect, contentW, ppf]);

  const frameAt = useCallback(
    (clientX: number) => {
      const el = scroller.current!;
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(total - 1, Math.floor((clientX - rect.left + el.scrollLeft) / ppf)));
    },
    [ppf, total],
  );

  const onPointerDown = (e: React.PointerEvent, kind: "seek" | "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind };
    if (kind === "seek") {
      onScrub(true);
      onSeek(frameAt(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const f = frameAt(e.clientX);
    if (drag.current.kind === "seek") onSeek(f);
    else if (drag.current.kind === "in") {
      onRangeChange(Math.min(f, range.outFrame), range.outFrame);
      onSeek(Math.min(f, range.outFrame));
    } else {
      onRangeChange(range.inFrame, Math.max(f, range.inFrame));
      onSeek(Math.max(f, range.inFrame));
    }
  };
  const onPointerUp = () => {
    if (drag.current?.kind === "seek") onScrub(false);
    drag.current = null;
  };

  const inX = x(range.inFrame);
  const outX = x(range.outFrame + 1);
  const headX = x(frame) + Math.min(ppf, 12) / 2;

  return (
    <div className="relative select-none" data-testid="timeline">
      <div
        ref={scroller}
        className="relative overflow-x-auto overflow-y-hidden"
        style={{ height: HEIGHT + 10 }}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative" style={{ width: contentW || "100%", height: HEIGHT }} onPointerDown={(e) => onPointerDown(e, "seek")}>
          <canvas ref={canvas} className="pointer-events-none sticky left-0 block" style={{ width, height: HEIGHT }} aria-hidden="true" />

          {/* Dim outside the range. */}
          <div className="pointer-events-none absolute bg-black/55" style={{ left: 0, width: Math.max(0, inX), top: RULER_H, height: STRIP_H }} />
          <div
            className="pointer-events-none absolute bg-black/55"
            style={{ left: outX, width: Math.max(0, contentW - outX), top: RULER_H, height: STRIP_H }}
          />
          {/* Range frame. */}
          <div
            className={`pointer-events-none absolute rounded-[2px] border-y-2 ${range.auto ? "border-dashed border-accent-line" : "border-accent"}`}
            style={{ left: inX, width: Math.max(2, outX - inX), top: RULER_H - 1, height: STRIP_H + 2 }}
            data-testid="range"
          />
          {(["in", "out"] as const).map((kind) => (
            <div
              key={kind}
              role="presentation"
              title={kind === "in" ? "Drag to set the in point" : "Drag to set the out point"}
              onPointerDown={(e) => onPointerDown(e, kind)}
              className={`absolute flex cursor-ew-resize items-center ${kind === "in" ? "justify-start" : "justify-end"}`}
              style={{ left: (kind === "in" ? inX : outX) - 8, width: 16, top: RULER_H - 1, height: STRIP_H + 2 }}
            >
              <div
                className={`h-full w-[7px] ${range.auto ? "bg-accent-line" : "bg-accent"} ${kind === "in" ? "ml-2 rounded-l-[3px]" : "mr-2 rounded-r-[3px]"}`}
              >
                <div className="mx-auto mt-[26px] h-3 w-px bg-accent-fg/60" />
              </div>
            </div>
          ))}

          {/* Playhead. */}
          <div className="pointer-events-none absolute top-0" style={{ left: headX, height: HEIGHT - PAD_B + 4 }} data-testid="playhead">
            <div className="absolute -left-[5px] top-[4px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-playhead" />
            <div className="absolute -left-px top-[4px] bottom-0 w-[2px] bg-playhead shadow-[0_0_0_1px_var(--in-surface)]" />
          </div>
        </div>
      </div>
    </div>
  );
});
