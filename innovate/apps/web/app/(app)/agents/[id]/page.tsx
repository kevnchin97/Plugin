import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentPanel } from "@/components/agents/AgentPanel";
import { finalizeTask, serializeTask } from "@/lib/agents";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const task = await finalizeTask(ctx, id.data).catch(() => null);
  if (!task) notFound();
  return (
    <div className="h-full overflow-y-auto">
      <AgentPanel key={task.id} initial={serializeTask(task)} />
    </div>
  );
}
