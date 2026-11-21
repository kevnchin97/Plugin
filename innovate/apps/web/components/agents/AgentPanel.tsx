"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toasts";
import type { AgentTaskDTO } from "@/lib/agents";

const STATUS: Record<string, string> = {
  queued: "Queued",
  running: "Working…",
  proposed: "Waiting for your approval",
  applying: "Applying…",
  applied: "Applied",
  undone: "Undone",
  failed: "Failed",
  cancelled: "Cancelled",
};
const LIVE = new Set(["queued", "running", "applying"]);

type Hit = { url?: string; title?: string; thumbnailUrl?: string | null; author?: string | null; id?: string; type?: string };

/** Partial results shown under a step (search hits, Vimeo results). */
function StepData({ data }: { data: unknown }) {
  if (!Array.isArray(data) || !data.length) return null;
  const items = data as Hit[];
  return (
    <ul className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
      {items.slice(0, 8).map((h, i) => (
        <li key={h.url ?? h.id ?? i} className="w-28 shrink-0 text-2xs text-text-muted">
          {h.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external thumbnail from the platform's API
            <img src={h.thumbnailUrl} alt="" className="aspect-video w-full rounded-xs bg-player object-cover" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-xs bg-surface-3 text-text-faint">{h.type ?? "link"}</div>
          )}
          <div className="mt-0.5 truncate">{h.title}</div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One agent run (SPEC §5.8): live step log with partial results, the proposal with a checkbox per
 * change, and Approve / Cancel / Retry / Undo. Polls while the run is live.
 */
export function AgentPanel({ initial }: { initial: AgentTaskDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [task, setTask] = useState(initial);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(initial.proposal?.actions.map((a) => a.index) ?? []));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!LIVE.has(task.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/agents/${task.id}`);
      if (!res.ok) return;
      const next = (await res.json()).task as AgentTaskDTO;
      setTask(next);
      if (next.status === "proposed" && next.proposal) setChosen(new Set(next.proposal.actions.map((a) => a.index)));
    }, 900);
    return () => clearInterval(t);
  }, [task.id, task.status]);

  const act = async (path: string, body?: unknown, done?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/${task.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      setTask(json.task);
      if (done) toast(done, "success");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const created = task.applied;
  return (
    <div className="mx-auto max-w-[920px] px-6 py-6" data-testid="agent-panel">
      <div className="mb-1 flex items-center gap-2 text-xs text-text-faint">
        <Link href="/agents" className="hover:text-text">
          Agents
        </Link>
        <span>/</span>
        <span>{task.kind === "research" ? "Research Agent" : "Agent"}</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Limited beta</span>
      </div>
      <h1 className="text-lg font-semibold">{task.prompt}</h1>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <span className={task.status === "failed" ? "text-danger" : "text-text-muted"} data-testid="agent-status">
          {STATUS[task.status] ?? task.status}
        </span>
        {(task.status === "queued" || task.status === "running") && (
          <button type="button" disabled={busy || task.cancelRequested} onClick={() => void act("cancel", undefined, "Cancelling")} className="text-sm text-danger hover:underline disabled:opacity-50">
            {task.cancelRequested ? "Cancelling…" : "Cancel"}
          </button>
        )}
        {["failed", "cancelled", "proposed"].includes(task.status) && (
          <button type="button" disabled={busy} onClick={() => void act("retry")} className="text-sm text-accent hover:underline">
            Retry
          </button>
        )}
      </div>
      {task.error && task.status !== "cancelled" && (
        <p className="mt-2 rounded-md border border-danger/40 bg-surface-2 px-3 py-2 text-sm text-danger" role="alert">
          {task.error}
        </p>
      )}

      {task.proposal && (
        <section className="mt-6 rounded-lg border border-border-strong bg-surface p-4" data-testid="agent-proposal">
          <h2 className="text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Proposal</h2>
          <p className="mt-1.5 text-md leading-relaxed">{task.proposal.summary}</p>
          {task.proposal.actions.length > 0 && (
            <ul className="mt-3 space-y-2">
              {task.proposal.actions.map((a) => (
                <li key={a.index} className="rounded-md border border-border p-3">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      disabled={task.status !== "proposed"}
                      checked={task.status === "proposed" ? chosen.has(a.index) : (task.applied?.approvedActions.includes(a.index) ?? false)}
                      onChange={(e) =>
                        setChosen((cur) => {
                          const next = new Set(cur);
                          if (e.target.checked) next.add(a.index);
                          else next.delete(a.index);
                          return next;
                        })
                      }
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium" data-testid="proposed-change">
                        {a.description}
                      </span>
                      {"reason" in a.action && a.action.reason && <span className="block text-sm text-text-muted">{a.action.reason}</span>}
                      {a.action.type === "save_links" && (
                        <ul className="mt-2 space-y-1.5" data-testid="shortlist">
                          {a.action.picks.map((p) => (
                            <li key={p.url} className="flex gap-2.5 text-sm">
                              {p.thumbnailUrl && (
                                // eslint-disable-next-line @next/next/no-img-element -- platform thumbnail
                                <img src={p.thumbnailUrl} alt="" className="aspect-video w-24 shrink-0 rounded-xs bg-player object-cover" />
                              )}
                              <span className="min-w-0">
                                <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                                  {p.title}
                                </a>
                                <span className="block text-text-muted" data-testid="pick-reason">
                                  {p.reason}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {a.action.type === "export_clips" && (
                        <span className="block text-xs text-text-faint">{a.action.ranges.map((r) => `${r.title || r.kind} (frames ${r.inFrame}–${r.outFrame})`).join(" · ")}</span>
                      )}
                      {a.action.type === "create_deck" && <span className="block text-xs text-text-faint">{a.action.slides.map((s) => s.heading || s.layout).join(" · ")}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-3">
            {task.status === "proposed" && task.proposal.actions.length > 0 && (
              <button type="button" disabled={busy || !chosen.size} onClick={() => void act("approve", { actions: [...chosen] }, "Applied")} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
                Approve {chosen.size === task.proposal.actions.length ? "all" : `${chosen.size}`}
              </button>
            )}
            {(task.status === "applied" || task.status === "applying") && (
              <button type="button" disabled={busy} onClick={() => void act("undo", undefined, "Undone")} className="h-8 rounded-md border border-border px-3 text-sm hover:bg-surface-2">
                Undo
              </button>
            )}
            {created && task.status === "applied" && (
              <span className="text-sm text-text-muted" data-testid="applied-summary">
                {[
                  created.boards.length && `${created.boards.length} board${created.boards.length === 1 ? "" : "s"}`,
                  created.references.length && `${created.references.length} reference${created.references.length === 1 ? "" : "s"}`,
                  created.decks.length && `${created.decks.length} deck`,
                  created.reels.length && `${created.reels.length} reel`,
                ]
                  .filter(Boolean)
                  .join(", ") || "Changes"}{" "}
                created
                {created.boards[0] && (
                  <>
                    {" · "}
                    <Link href={`/boards/${created.boards[0]}`} className="text-accent hover:underline">
                      Open board
                    </Link>
                  </>
                )}
                {created.decks[0] && (
                  <>
                    {" · "}
                    <Link href={`/decks/${created.decks[0]}`} className="text-accent hover:underline">
                      Open deck
                    </Link>
                  </>
                )}
                {created.reels[0] && (
                  <>
                    {" · "}
                    <Link href={`/reels/${created.reels[0]}`} className="text-accent hover:underline">
                      Open reel
                    </Link>
                  </>
                )}
              </span>
            )}
            {task.status === "applying" && created?.pendingExports.length ? <span className="text-sm text-text-muted">Rendering {created.pendingExports.length} export(s)…</span> : null}
          </div>
          {created?.errors.length ? (
            <ul className="mt-2 text-sm text-danger">
              {created.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Steps</h2>
        <ol className="space-y-2 border-l border-border pl-4" data-testid="agent-steps">
          {task.steps.map((s, i) => (
            <li key={i} className="relative text-sm">
              <span className={`absolute top-1.5 -left-[21px] h-2 w-2 rounded-full ${s.kind === "error" ? "bg-danger" : s.kind === "proposal" ? "bg-accent" : "bg-border-strong"}`} />
              <span className={s.kind === "error" ? "text-danger" : s.kind === "thinking" ? "text-text-muted italic" : "text-text"}>{s.text}</span>
              <StepData data={s.data} />
            </li>
          ))}
          {LIVE.has(task.status) && <li className="text-sm text-text-faint">…</li>}
        </ol>
      </section>
    </div>
  );
}
