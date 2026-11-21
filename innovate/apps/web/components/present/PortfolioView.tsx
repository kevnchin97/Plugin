"use client";
import { useState } from "react";
import { aspectOf } from "@/components/board/cards";
import { MotionMedia } from "@/components/media/MotionMedia";
import { Logo } from "@/components/ui/Logo";
import type { Playable, PortfolioData } from "@/lib/present";
import { ReelPlayer } from "./ReelPlayer";

type Item = PortfolioData["items"][number];

/**
 * Public portfolio page (SPEC §5.5): three layout templates (grid, feature, list), a bio and a
 * contact block. Motion references play on hover (never with reduced motion); reels get the
 * clean sequence player.
 */
export function PortfolioView({ data }: { data: Pick<PortfolioData, "portfolio" | "items" | "media" | "reels"> }) {
  const p = data.portfolio;
  const [hover, setHover] = useState<string | null>(null);

  const piece = (item: Item, big = false) => {
    if (item.reelId) {
      const reel = data.reels[item.reelId];
      if (!reel) return null;
      return (
        <figure className="overflow-hidden rounded-md" data-testid="portfolio-item">
          <ReelPlayer reel={{ ...reel.reel, items: reel.items, media: reel.media }} />
          <figcaption className="mt-2 text-sm">
            <span className="font-medium">{reel.reel.title}</span>
            {item.caption && <span className="text-text-muted"> · {item.caption}</span>}
          </figcaption>
        </figure>
      );
    }
    const m: Playable | undefined = item.referenceId ? data.media[item.referenceId] : undefined;
    if (!m) return null;
    return (
      <figure onMouseEnter={() => setHover(item.id)} onMouseLeave={() => setHover(null)} data-testid="portfolio-item">
        <div className="overflow-hidden rounded-md bg-player" style={{ aspectRatio: aspectOf(m) }}>
          {m.type === "video" && m.playUrl && big ? (
            <video src={m.playUrl} controls playsInline poster={m.thumbnailUrl ?? undefined} className="h-full w-full object-contain" />
          ) : (
            <MotionMedia item={m} active={hover === item.id} />
          )}
        </div>
        {(item.caption || m.title) && (
          <figcaption className="mt-2 text-sm">
            <span className="font-medium">{m.title}</span>
            {item.caption && <span className="text-text-muted"> · {item.caption}</span>}
          </figcaption>
        )}
      </figure>
    );
  };

  return (
    <div className="min-h-full bg-bg text-text" data-testid="portfolio">
      <header className="mx-auto max-w-[1280px] px-6 pt-14 pb-10 md:px-10">
        <h1 className="text-[clamp(28px,4vw,48px)] leading-[1.05] font-semibold tracking-[-0.02em]" data-testid="portfolio-title">
          {p.title || "Portfolio"}
        </h1>
        {p.bio && <p className="mt-4 max-w-[640px] text-lg leading-relaxed whitespace-pre-wrap text-text-muted">{p.bio}</p>}
        {(p.contactEmail || p.website) && (
          <div className="mt-5 flex flex-wrap gap-4 text-sm" data-testid="portfolio-contact">
            {p.contactEmail && (
              <a href={`mailto:${p.contactEmail}`} className="text-accent hover:underline">
                {p.contactEmail}
              </a>
            )}
            {p.website && (
              <a href={p.website} rel="noopener noreferrer" target="_blank" className="text-accent hover:underline">
                {p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1280px] px-6 pb-16 md:px-10">
        {p.template === "feature" ? (
          <>
            {data.items[0] && <div className="mb-10">{piece(data.items[0], true)}</div>}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.slice(1).map((i) => (
                <div key={i.id}>{piece(i)}</div>
              ))}
            </div>
          </>
        ) : p.template === "list" ? (
          <div className="space-y-12">
            {data.items.map((i) => (
              <div key={i.id} className="mx-auto max-w-[960px]">
                {piece(i, true)}
              </div>
            ))}
          </div>
        ) : (
          <div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
            {data.items.map((i) => (
              <div key={i.id} className="mb-6 break-inside-avoid">
                {piece(i)}
              </div>
            ))}
          </div>
        )}
        {!data.items.length && <p className="text-sm text-text-muted">Nothing here yet.</p>}
      </main>
      <footer className="flex justify-center pb-8 text-text-faint opacity-60">
        <Logo compact />
      </footer>
    </div>
  );
}
