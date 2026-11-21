import Anthropic from "@anthropic-ai/sdk";
import type { Job } from "bullmq";
import { agentTasks, eq, sql } from "@innovate/db";
import type { AgentAction, AgentJobData, AgentProposal, AgentStep, AgentStepKind } from "@innovate/shared";
import { publish } from "@innovate/shared/realtime";
import { CLAUDE_MODEL, claude, FALLBACK_BETA } from "../claude";
import { db } from "../context";
import { runTool, TOOL_PARAMS, type ToolContext } from "./tools";

/** Tool-use turns per run (each turn may call several tools). */
const MAX_TURNS = 24;

const SYSTEM = `You are the assistant inside Innovate, a visual research workspace for filmmakers (directors, cinematographers, treatment designers).
You work only through the tools provided. You can read the user's library and boards, inspect a video's detected scenes, search Vimeo, and import a video link into the library.
Every change to boards or decks is a PROPOSAL: use the propose_* tools. Nothing is applied until the user approves it, so never say you created, saved or changed anything; say what you propose.

How to work:
- Ground every proposal in tool results. Only use reference ids, board ids and frame numbers that a tool returned. Never invent links.
- Prefer few, well-chosen items over many. A shortlist of 5–8 strong picks beats 20 weak ones.
- When choosing shots, think like a cinematographer: light, palette, movement, framing, lens feel.
- For GIFs or clips of specific moments, call get_scenes and use its frame ranges. Whip pans and fast camera moves have high motion scores. Keep GIFs under 6 seconds unless asked.
- When you research references on Vimeo, give every pick a one-line reason a filmmaker would find useful (what to look at, not a plot summary).
- If something the user asked for isn't possible with these tools (for example, a platform that isn't enabled), say so plainly.
Finish with two or three plain sentences summarising what you propose and why. No headings or lists in that summary.`;

const RESEARCH = `This is a Research Agent request: search Vimeo for the brief (try two or three different queries that capture its look, era, format and movement), read the results, then call propose_save_links once with your shortlist on a new board named after the brief, each pick with a one-line reason.`;

async function step(taskId: string, kind: AgentStepKind, text: string, data?: unknown) {
  const entry: AgentStep = { at: new Date().toISOString(), kind, text: text.slice(0, 4000), ...(data === undefined ? {} : { data }) };
  await db
    .update(agentTasks)
    .set({ steps: sql`${agentTasks.steps} || ${JSON.stringify([entry])}::jsonb`, updatedAt: new Date() })
    .where(eq(agentTasks.id, taskId));
  await publish(`agent:${taskId}`, { type: "activity", entry });
}

class Cancelled extends Error {}

/** A short, readable line for the step log. */
function describeCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_library":
      return `Searching your library for “${String(i.query ?? "")}”`;
    case "search_vimeo":
      return `Searching Vimeo for “${String(i.query ?? "")}”`;
    case "list_boards":
      return "Looking at your boards";
    case "get_board":
      return "Reading a board";
    case "recent_uploads":
      return `Finding your last ${String(i.count ?? "")} uploads`;
    case "get_scenes":
      return "Reading the video's scenes";
    case "ingest_link":
      return `Importing ${String(i.url ?? "the link")}`;
    default:
      return name.startsWith("propose_") ? `Proposing: ${name.slice(8).replace(/_/g, " ")}` : name;
  }
}

function summarize(value: unknown): { text: string; data?: unknown } {
  if (Array.isArray(value)) return { text: `${value.length} result${value.length === 1 ? "" : "s"}`, data: value.slice(0, 12) };
  if (value && typeof value === "object" && "scenes" in value) return { text: `${(value as { scenes: unknown[] }).scenes.length} scenes` };
  if (value && typeof value === "object" && "change" in value) return { text: String((value as { change: string }).change) };
  if (value && typeof value === "object" && "title" in value && "type" in value) return { text: `Imported “${String((value as { title: string }).title)}”` };
  return { text: "Done" };
}

/**
 * Run one agent task (SPEC §5.8) as a manual tool-use loop on the Messages API: Claude reads
 * through the tools and records proposals; the run ends with a proposal for the user to approve
 * (the web app applies it). Cancel is checked between turns and aborts the request in flight.
 */
export async function runAgent(job: Job<AgentJobData>) {
  const { taskId, workspaceId } = job.data;
  const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, taskId));
  if (!task || task.workspaceId !== workspaceId) throw new Error("Agent task not found");
  if (task.status !== "queued") return { skipped: task.status };
  const client = claude();
  if (!client) {
    await db.update(agentTasks).set({ status: "failed", error: "Agents need ANTHROPIC_API_KEY on the server." }).where(eq(agentTasks.id, taskId));
    return { failed: "no key" };
  }

  await db.update(agentTasks).set({ status: "running", error: null }).where(eq(agentTasks.id, taskId));
  await publish(`agent:${taskId}`, { type: "activity", entry: { status: "running" } });
  const abort = new AbortController();
  const watch = setInterval(async () => {
    const [t] = await db.select({ c: agentTasks.cancelRequested }).from(agentTasks).where(eq(agentTasks.id, taskId));
    if (t?.c) abort.abort();
  }, 1000);

  const actions: AgentAction[] = [];
  const ctx: ToolContext = { workspaceId, userId: task.userId, taskId, actions, signal: abort.signal };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: task.kind === "research" ? `${RESEARCH}\n\nBrief: ${task.prompt}` : task.prompt },
  ];
  let summary = "";
  try {
    await step(taskId, "thinking", task.kind === "research" ? "Research Agent started" : "Agent started");
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (abort.signal.aborted) throw new Cancelled();
      const res = await client.beta.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: "high" },
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          tools: TOOL_PARAMS,
          messages,
        },
        { signal: abort.signal },
      );
      if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
      // Pass the whole content back (thinking blocks included) as the next assistant turn.
      messages.push({ role: "assistant", content: res.content });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const calls = res.content.filter((b) => b.type === "tool_use");
      if (text) {
        if (calls.length) await step(taskId, "thinking", text);
        else summary = text;
      }
      if (res.stop_reason === "pause_turn") continue;
      if (!calls.length) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        if (abort.signal.aborted) throw new Cancelled();
        await step(taskId, "tool", describeCall(call.name, call.input));
        const out = await runTool(call.name, call.input, ctx);
        if (out.ok) {
          const s = summarize(out.value);
          await step(taskId, call.name.startsWith("propose_") ? "proposal" : "result", s.text, s.data);
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out.value).slice(0, 60_000) });
        } else {
          await step(taskId, "error", out.error);
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.error, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      if (turn === MAX_TURNS - 1) summary ||= "Stopped after the maximum number of steps; here is what I have so far.";
    }

    const proposal: AgentProposal = { summary: summary || (actions.length ? "Here's what I propose." : "I didn't find anything to propose."), actions };
    await db.update(agentTasks).set({ status: "proposed", proposal }).where(eq(agentTasks.id, taskId));
    await step(taskId, "done", actions.length ? `Proposed ${actions.length} change${actions.length === 1 ? "" : "s"} for your approval` : "Finished with nothing to apply");
    return { actions: actions.length };
  } catch (err) {
    const cancelled = err instanceof Cancelled || abort.signal.aborted;
    const message = cancelled
      ? "Cancelled"
      : err instanceof Anthropic.AuthenticationError
        ? "The Anthropic API key was rejected."
        : err instanceof Anthropic.RateLimitError
          ? "Claude is rate-limited right now; retry in a minute."
          : err instanceof Anthropic.APIError
            ? `Claude API error (${err.status ?? "network"}): ${err.message}`
            : (err as Error).message;
    // Keep partial proposals visible, but a cancelled or failed run can't be approved.
    await db
      .update(agentTasks)
      .set({ status: cancelled ? "cancelled" : "failed", error: message, proposal: actions.length ? { summary: "Partial results (the run didn't finish).", actions } : null })
      .where(eq(agentTasks.id, taskId));
    await step(taskId, "error", message);
    return { error: message };
  } finally {
    clearInterval(watch);
  }
}
