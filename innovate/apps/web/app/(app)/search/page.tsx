import { Suspense } from "react";
import { SearchView } from "@/components/search/SearchView";
import { listBoards } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Search" };

export default async function SearchPage() {
  const ctx = await requirePageSession();
  const boards = await listBoards(ctx.workspaceId, ctx.userId);
  return (
    <Suspense>
      <SearchView boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />
    </Suspense>
  );
}
