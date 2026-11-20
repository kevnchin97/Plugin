"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReferenceDTO } from "@/lib/media";

const TYPE_LABEL: Record<string, string> = { video: "Video", gif: "GIF", clip: "Clip", still: "Still" };

const REDUCED = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
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

/** Native aspect ratio, never cropped. Motion plays muted on hover only (and never with reduced motion). */
function Media({ item, hovering }: { item: ReferenceDTO; hovering: boolean }) {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [poster, setPoster] = useState(false);
  const animate = hovering && !reduced;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (animate) v.play().catch(() => {});
    else v.pause();
  }, [animate]);

  if (item.type === "clip" && item.mediaUrl)
    return <video ref={video} src={item.mediaUrl} muted loop playsInline preload="metadata" className="block h-full w-full object-contain" />;
  if (item.type === "gif" && item.mediaUrl) {
    // A canvas holds the first frame as a still poster; the animated <img> only mounts on hover.
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.mediaUrl}
          alt=""
          className={`block h-full w-full object-contain ${animate || !poster ? "" : "hidden"}`}
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
        <canvas ref={canvas} className={`block h-full w-full object-contain ${animate || !poster ? "hidden" : ""}`} />
      </>
    );
  }
  const src = item.type === "still" ? item.mediaUrl : item.thumbnailUrl;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className="block h-full w-full object-contain" /> : <div className="h-full w-full" />;
}

function Card({ item, parent }: { item: ReferenceDTO; parent?: ReferenceDTO }) {
  const [hovering, setHovering] = useState(false);
  const aspect = item.width && item.height ? item.width / item.height : 16 / 9;
  const href = item.type === "video" ? `/make/${item.id}` : (item.mediaUrl ?? "#");
  return (
    <li className="mb-3 break-inside-avoid" data-testid="library-item" data-type={item.type}>
      <Link
        href={href}
        target={item.type === "video" ? undefined : "_blank"}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className="group block overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
      >
        <div className="relative bg-player" style={{ aspectRatio: aspect }}>
          <Media item={item} hovering={hovering} />
          <span className="absolute top-2 left-2 rounded-xs bg-black/65 px-1.5 py-px text-2xs font-medium text-white/85">{TYPE_LABEL[item.type] ?? item.type}</span>
          {item.status !== "ready" && (
            <span className="absolute inset-0 grid place-items-center bg-black/60 text-xs text-white/80">
              {item.status === "failed" ? "Failed" : "Processing…"}
            </span>
          )}
        </div>
        <div className="px-2.5 py-2">
          <div className="truncate text-sm">{item.title}</div>
          {parent && <div className="truncate text-2xs text-text-faint">from {parent.title}</div>}
        </div>
      </Link>
    </li>
  );
}

export function LibraryGrid({ items }: { items: ReferenceDTO[] }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  // Extracted items sit right after their source.
  const sources = items.filter((i) => !i.parentReferenceId || !byId.has(i.parentReferenceId));
  const ordered = sources.flatMap((s) => [s, ...items.filter((c) => c.parentReferenceId === s.id)]);
  // TODO(M2): virtualized masonry (TanStack Virtual), boards, clusters and multi-select.
  return (
    <ul className="columns-[260px] gap-3">
      {ordered.map((item) => (
        <Card key={item.id} item={item} parent={item.parentReferenceId ? byId.get(item.parentReferenceId) : undefined} />
      ))}
    </ul>
  );
}
