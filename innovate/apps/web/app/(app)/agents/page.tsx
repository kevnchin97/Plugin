import Link from "next/link";
import { agentsEnabled, listTasks } from "@/lib/agents";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Agents" };

const STATUS: Record<string, string> = { queued: "Queued", running: "Working", proposed: "Needs approval", applying: "Applying", applied: "Applied", undone: "Undone", failed: "Failed", cancelled: "Cancelled" };

export default async function AgentsPage() {
  const ctx = await requirePageSession();
  const tasks = await listTasks(ctx.workspaceId);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-6 py-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
              Agents <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Limited beta</span>
            </h1>
            <p className="text-sm text-text-muted">Ask with ⌘K. Agents research and draft; nothing changes until you approve, and every applied change can be undone.</p>
          </div>
        </div>
        {!agentsEnabled() && (
          <p className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
            Agents are off on this server: they need <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>.
          </p>
        )}
        {tasks.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/agents/${t.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2" data-testid="agent-task-link">
                  <span className="min-w-0 truncate">{t.prompt}</span>
                  <span className="shrink-0 text-xs text-text-faint">
                    {STATUS[t.status] ?? t.status} · {new Date(t.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-[200px] place-items-center rounded-lg border border-dashed border-border-strong text-center text-sm text-text-muted">No agent runs yet. Press ⌘K to ask.</div>
        )}
      </div>
    </div>
  );
}
