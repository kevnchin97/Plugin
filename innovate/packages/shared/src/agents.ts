/**
 * Agents (SPEC §5.8): the proposal contract between the worker (where the Claude loop runs and
 * only PROPOSES) and the web app (where the user approves, the proposal is applied, and can be
 * undone). Every action is something a user could do in the UI.
 */
import { z } from "zod";
import { SLIDE_LAYOUTS } from "./present";

export const AGENT_QUEUE = "agent";
export interface AgentJobData {
  taskId: string;
  workspaceId: string;
}

const title = z.string().trim().min(1).max(200);
const ids = (max: number) => z.array(z.uuid()).min(1).max(max);

/** Where saved things go: an existing board, or a new board with this title. */
export const boardTargetSchema = z.union([z.object({ boardId: z.uuid() }), z.object({ newBoardTitle: title })]);

export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_board"),
    title,
    referenceIds: ids(60),
    notes: z.array(z.string().max(1000)).max(10).default([]),
    reason: z.string().max(500).default(""),
  }),
  z.object({ type: z.literal("add_to_board"), boardId: z.uuid(), referenceIds: ids(60), reason: z.string().max(500).default("") }),
  z.object({
    type: z.literal("save_links"),
    target: boardTargetSchema,
    picks: z
      .array(z.object({ url: z.url({ protocol: /^https?$/ }), title: z.string().max(300), reason: z.string().min(1).max(300), thumbnailUrl: z.url().nullable().default(null) }))
      .min(1)
      .max(30),
  }),
  z.object({
    type: z.literal("export_clips"),
    referenceId: z.uuid(),
    target: boardTargetSchema,
    ranges: z
      .array(z.object({ kind: z.enum(["gif", "clip"]), inFrame: z.number().int().min(0), outFrame: z.number().int().min(0), title: z.string().max(200) }).refine((r) => r.outFrame >= r.inFrame, "Out must be after in."))
      .min(1)
      .max(20),
    reason: z.string().max(500).default(""),
  }),
  z.object({
    type: z.literal("create_deck"),
    title,
    boardId: z.uuid().nullable().default(null),
    slides: z
      .array(z.object({ layout: z.enum(SLIDE_LAYOUTS), heading: z.string().max(300).default(""), body: z.string().max(2000).default(""), referenceIds: z.array(z.uuid()).max(6).default([]) }))
      .min(1)
      .max(30),
  }),
  z.object({
    type: z.literal("create_reel"),
    title,
    titleCard: z.string().max(120).default(""),
    endCard: z.string().max(120).default(""),
    items: z.array(z.object({ referenceId: z.uuid(), inSec: z.number().min(0).nullable().default(null), outSec: z.number().min(0).nullable().default(null) })).min(1).max(60),
  }),
]);
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionType = AgentAction["type"];

export interface AgentProposal {
  summary: string;
  actions: AgentAction[];
}

export type AgentStepKind = "thinking" | "tool" | "result" | "proposal" | "error" | "done";
export interface AgentStep {
  at: string;
  kind: AgentStepKind;
  text: string;
  /** Partial results the UI can show (e.g. search hits, a Vimeo shortlist). */
  data?: unknown;
}

/** What approving created, so undo removes exactly that (and nothing the user made since). */
export interface AgentApplied {
  approvedActions: number[];
  boards: string[];
  boardItems: string[];
  references: string[];
  decks: string[];
  reels: string[];
  /** Exports still rendering on the worker; saved (and recorded above) as they finish. */
  pendingExports: { jobId: string; title: string; boardId: string }[];
  errors: string[];
}

export const createAgentTaskSchema = z.object({ prompt: z.string().trim().min(3, "Describe what you want the agent to do.").max(2000) });
export const approveAgentSchema = z.object({ actions: z.array(z.number().int().min(0)).min(1, "Pick at least one change to apply.").max(50) });

/** Research briefs get the Research Agent prompt; everything else the general agent. */
export function agentKindFor(prompt: string): "research" | "general" {
  return /^\s*(research|find (me )?(references|refs)|look for references)\b/i.test(prompt) ? "research" : "general";
}

export function describeAction(a: AgentAction): string {
  switch (a.type) {
    case "create_board":
      return `Create board “${a.title}” with ${a.referenceIds.length} reference${a.referenceIds.length === 1 ? "" : "s"}`;
    case "add_to_board":
      return `Add ${a.referenceIds.length} reference${a.referenceIds.length === 1 ? "" : "s"} to a board`;
    case "save_links":
      return `Save ${a.picks.length} pick${a.picks.length === 1 ? "" : "s"} to ${"boardId" in a.target ? "a board" : `new board “${a.target.newBoardTitle}”`}`;
    case "export_clips":
      return `Export ${a.ranges.length} ${a.ranges.every((r) => r.kind === "gif") ? "GIF" : "clip"}${a.ranges.length === 1 ? "" : "s"} to ${"boardId" in a.target ? "a board" : `new board “${a.target.newBoardTitle}”`}`;
    case "create_deck":
      return `Draft deck “${a.title}” (${a.slides.length} slides)`;
    case "create_reel":
      return `Assemble reel “${a.title}” (${a.items.length} clips)`;
  }
}
