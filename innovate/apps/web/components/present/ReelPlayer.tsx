"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REEL_CARD_SECONDS, trimmedDuration } from "@innovate/shared";
import type { Playable } from "@/lib/present";

export interface ReelSequence {
  title: string;
  titleCard: string;
  titleCardSub: string;
  endCard: string;
  endCardSub: string;
  items: { id: string; referenceId: string; inSec: number | null; outSec: number | null }[];
  media: Record<string, Playable | undefined>;
}

type Segment =
  | { kind: "card"; key: string; title: string; sub: string }
  | { kind: "clip"; key: string; url: string; start: number; end: number; title: string };

export function reelSegments(r: ReelSequence): Segment[] {
  const out: Segment[] = [];
  if (r.titleCard) out.push({ kind: "card", key: "title", title: r.titleCard, sub: r.titleCardSub });
  for (const it of r.items) {
    const m = r.media[it.referenceId];
    if (!m?.playUrl || !m.duration) continue;
    const start = Math.max(0, Math.min(it.inSec ?? 0, m.duration));
    out.push({ kind: "clip", key: it.id, url: m.playUrl, start, end: start + trimmedDuration(it, m.duration), title: m.title });
  }
  if (r.endCard) out.push({ kind: "card", key: "end", title: r.endCard, sub: r.endCardSub });
  return out;
}

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function reelDuration(r: ReelSequence) {
  return reelSegments(r).reduce((a, s) => a + (s.kind === "card" ? REEL_CARD_SECONDS : s.end - s.start), 0);
}

/**
 * A clean sequence player for a reel (SPEC §5.5): title card, each clip within its trims, end
 * card. One <video> element is re-pointed per clip and seeks to the clip's in point; the next
 * clip is preloaded in a hidden element so cuts don't stall.
 */
export function ReelPlayer({ reel, autoStart = false }: { reel: ReelSequence; autoStart?: boolean }) {
  const segments = useMemo(() => reelSegments(reel), [reel]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(autoStart);
  const [done, setDone] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const seg = segments[Math.min(index, segments.length - 1)];
  const nextClip = segments.slice(index + 1).find((s) => s.kind === "clip");

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= segments.length) {
        setPlaying(false);
        setDone(true);
        return i;
      }
      return i + 1;
    });
  }, [segments.length]);

  // Cards hold for a fixed time while playing.
  useEffect(() => {
    if (!playing || seg?.kind !== "card") return;
    const t = setTimeout(next, REEL_CARD_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [playing, seg, next]);

  // Clips: seek to the in point, play, advance at the out point.
  useEffect(() => {
    const v = video.current;
    if (!v || seg?.kind !== "clip") return;
    const onMeta = () => {
      v.currentTime = seg.start;
      if (playing) v.play().catch(() => setPlaying(false));
    };
    const onTime = () => {
      if (v.currentTime >= seg.end - 0.02) next();
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", next);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", next);
    };
  }, [seg, playing, next]);

  useEffect(() => {
    const v = video.current;
    if (!v || seg?.kind !== "clip") return;
    if (playing) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, seg]);

  const start = () => {
    setStarted(true);
    setDone(false);
    if (done) setIndex(0);
    setPlaying(true);
  };

  if (!segments.length)
    return <div className="grid aspect-video w-full place-items-center bg-player text-sm text-white/60">Add clips to see the reel.</div>;

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-player text-white" data-testid="reel-player" data-segment={index} data-playing={playing}>
      {seg?.kind === "clip" ? (
        <video key={seg.key} ref={video} src={seg.url} playsInline preload="auto" className="h-full w-full object-contain" data-testid="reel-video" />
      ) : (
        <div key={seg?.key} className="grid h-full w-full place-items-center px-8 text-center" data-testid="reel-card">
          <div>
            <div className="leading-[1.1] font-semibold tracking-[-0.02em]" style={{ fontSize: "clamp(20px,4vw,56px)" }}>
              {seg?.title}
            </div>
            {seg?.sub && <div className="mt-3 text-white/60" style={{ fontSize: "clamp(12px,1.6vw,22px)" }}>{seg.sub}</div>}
          </div>
        </div>
      )}
      {nextClip?.kind === "clip" && <video src={nextClip.url} preload="auto" muted className="hidden" aria-hidden />}

      {(!started || done) && (
        <button
          type="button"
          onClick={start}
          className="absolute inset-x-0 bottom-0 flex h-1/3 items-end justify-center bg-gradient-to-t from-black/55 to-transparent pb-[6%]"
          aria-label={done ? "Play the reel again" : `Play ${reel.title}`}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-black shadow-md hover:bg-white">
            <span aria-hidden>{done ? "↺" : "▶"}</span>
            {done ? "Play again" : "Play"}
            <span className="font-mono text-xs text-black/60">{fmtDur(reelDuration(reel))}</span>
          </span>
        </button>
      )}
      {started && !done && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-xs opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded-sm bg-white/15 px-2 py-1 hover:bg-white/25" aria-label={playing ? "Pause" : "Play"}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} className="rounded-sm bg-white/15 px-2 py-1 hover:bg-white/25" aria-label="Previous">
            ←
          </button>
          <button type="button" onClick={next} className="rounded-sm bg-white/15 px-2 py-1 hover:bg-white/25" aria-label="Next">
            →
          </button>
          <div className="flex flex-1 gap-0.5">
            {segments.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setIndex(i)} aria-label={`Go to ${s.title}`} className={`h-1 flex-1 rounded-full ${i < index ? "bg-white/80" : i === index ? "bg-white" : "bg-white/25"}`} />
            ))}
          </div>
          <span className="font-mono text-white/70">
            {index + 1}/{segments.length}
          </span>
        </div>
      )}
    </div>
  );
}
