import { notFound } from "next/navigation";
import { z } from "zod";
import { Editor } from "@/components/editor/Editor";
import { getReference, serializeReference } from "@/lib/media";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Editor" };

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const ref = await getReference(ctx.workspaceId, id.data).catch(() => null);
  if (!ref || ref.type !== "video") notFound();
  return <Editor initial={await serializeReference(ref)} />;
}
