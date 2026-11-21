import { notFound } from "next/navigation";
import { z } from "zod";
import { Editor } from "@/components/editor/Editor";
import { listBoards } from "@/lib/boards";
import { getReference, serializeReference } from "@/lib/media";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Editor" };

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ in?: string; out?: string; board?: string }>;
}) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const ref = await getReference(ctx.workspaceId, id.data).catch(() => null);
  if (!ref || ref.type !== "video") notFound();
  const sp = await searchParams;
  const mark = (v?: string) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const boardsList = await listBoards(ctx.workspaceId, ctx.userId);
  const fromBoard = z.uuid().safeParse(sp.board);
  const board = fromBoard.success ? boardsList.all.find((b) => b.id === fromBoard.data) : undefined;
  return (
    <Editor
      initial={await serializeReference(ref)}
      initialMarks={{ inFrame: mark(sp.in), outFrame: mark(sp.out) }}
      fromBoard={board ? { id: board.id, title: board.isHome ? "Home" : board.title, href: board.isHome ? "/" : `/boards/${board.id}` } : null}
      boards={[
        ...(board ? [{ id: board.id, title: board.isHome ? "Home" : board.title }] : []),
        ...boardsList.recent.concat(boardsList.top.filter((b) => !boardsList.recent.some((r) => r.id === b.id))).filter((b) => b.id !== board?.id).map((b) => ({ id: b.id, title: b.title })),
      ]}
    />
  );
}
