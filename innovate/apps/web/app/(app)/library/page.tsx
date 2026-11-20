import Link from "next/link";
import { desc, eq, references } from "@innovate/db";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { listBoards, serializeRefLite } from "@/lib/boards";
import { db } from "@/lib/server";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Library" };

const FIRST_PAGE = 200;

export default async function LibraryPage() {
  const ctx = await requirePageSession();
  const rows = await db()
    .select()
    .from(references)
    .where(eq(references.workspaceId, ctx.workspaceId))
    .orderBy(desc(references.createdAt))
    .limit(FIRST_PAGE);
  const [items, boardsList] = await Promise.all([Promise.all(rows.map(serializeRefLite)), listBoards(ctx.workspaceId, ctx.userId)]);
  const next = rows.length === FIRST_PAGE ? rows[rows.length - 1]!.createdAt.toISOString() : null;
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[1600px] shrink-0 items-end justify-between px-6 pt-6 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Library</h1>
          <p className="text-sm text-text-muted">Everything in this workspace, newest first.</p>
        </div>
        <Link href="/make" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-base font-medium text-accent-fg hover:bg-accent-strong">
          New from video
        </Link>
      </div>
      <LibraryGrid initial={items} next={next} boards={boardsList.all} />
    </div>
  );
}
