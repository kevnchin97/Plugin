import Link from "next/link";
import { desc, eq, references } from "@innovate/db";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { serializeReference } from "@/lib/media";
import { db } from "@/lib/server";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const ctx = await requirePageSession();
  const rows = await db()
    .select()
    .from(references)
    .where(eq(references.workspaceId, ctx.workspaceId))
    .orderBy(desc(references.createdAt))
    .limit(300);
  const items = await Promise.all(rows.map(serializeReference));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Library</h1>
            <p className="text-sm text-text-muted">{items.length ? `${items.length} references` : "Nothing here yet."}</p>
          </div>
          <Link href="/make" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-base font-medium text-accent-fg hover:bg-accent-strong">
            New from video
          </Link>
        </div>
        {items.length ? (
          <LibraryGrid items={items} />
        ) : (
          <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-border-strong text-center">
            <div>
              <p className="text-md">Start with a video.</p>
              <p className="mt-1 text-sm text-text-muted">Upload footage, find the moment, and save stills, GIFs and clips here.</p>
              <Link href="/make" className="mt-4 inline-block text-sm text-accent hover:underline">
                Open the GIF Maker →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
