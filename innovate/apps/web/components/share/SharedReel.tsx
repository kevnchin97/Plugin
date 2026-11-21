"use client";
import { ReelPlayer } from "@/components/present/ReelPlayer";
import { Logo } from "@/components/ui/Logo";
import type { ReelData } from "@/lib/present";

/** A reel shared as a link: just the work, a clean player, the title and the end-card contact. */
export function SharedReel({ data }: { data: ReelData }) {
  const r = data.reel;
  return (
    <div data-theme="dark" className="flex min-h-full flex-col bg-bg text-text">
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col justify-center px-6 py-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]" data-testid="shared-title">
              {r.title}
            </h1>
            {r.titleCardSub && <p className="text-sm text-text-muted">{r.titleCardSub}</p>}
          </div>
          {r.renderUrl && (
            <a href={r.renderUrl} download className="text-sm text-text-muted hover:text-text">
              Download MP4
            </a>
          )}
        </div>
        <div className="overflow-hidden rounded-md shadow-lg">
          <ReelPlayer reel={{ ...r, items: data.items, media: data.media }} />
        </div>
        {r.endCardSub && <p className="mt-4 text-sm text-text-muted">{r.endCardSub}</p>}
      </main>
      <footer className="flex justify-center py-6 text-text-faint opacity-70">
        <Logo compact />
      </footer>
    </div>
  );
}
