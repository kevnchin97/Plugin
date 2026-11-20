"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";
export function useReducedMotion() {
  return useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia(REDUCED);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    },
    () => window.matchMedia(REDUCED).matches,
    () => true,
  );
}

export interface MediaLike {
  type: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

/**
 * A reference's media at its native aspect ratio (never cropped). GIFs and clips stay still
 * until hovered or focused, then play muted; with reduced motion they never autoplay (SPEC §2, §6).
 */
export function MotionMedia({ item, active, className = "" }: { item: MediaLike; active: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [poster, setPoster] = useState(false);
  const animate = active && !reduced;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (animate) v.play().catch(() => {});
    else v.pause();
  }, [animate]);

  const cls = `block h-full w-full object-contain ${className}`;
  if (item.type === "clip" && item.mediaUrl)
    return <video ref={video} src={item.mediaUrl} muted loop playsInline preload="metadata" className={cls} draggable={false} />;
  if (item.type === "gif" && item.mediaUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.mediaUrl}
          alt=""
          draggable={false}
          className={`${cls} ${animate || !poster ? "" : "hidden"}`}
          onLoad={(e) => {
            const c = canvas.current;
            const img = e.currentTarget;
            if (!c || poster) return;
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext("2d")?.drawImage(img, 0, 0);
            setPoster(true);
          }}
        />
        <canvas ref={canvas} className={`${cls} ${animate || !poster ? "hidden" : ""}`} />
      </>
    );
  }
  const src = item.type === "still" || item.type === "image" ? (item.mediaUrl ?? item.thumbnailUrl) : item.thumbnailUrl;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" draggable={false} className={cls} /> : <div className="h-full w-full" />;
}
