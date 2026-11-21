import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

/** SPEC §5.8: agents and descriptions run on Claude Opus 5.5. */
export const CLAUDE_MODEL = "claude-opus-5-5";
/** Server-side refusal fallback (routes by refusal category, no model list to maintain). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null | undefined;
/** Null when ANTHROPIC_API_KEY isn't set: callers skip Claude features instead of failing. */
export function claude(): Anthropic | null {
  if (client === undefined) client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  return client;
}

const DESCRIBE_PROMPT = `These are frames from one visual reference a filmmaker saved{TITLE}.
Write a description for their search index: one or two plain sentences covering subject, setting, light,
colour palette, and framing or camera movement if it's evident. No preamble, no lists, under 60 words.`;

/** One- or two-sentence description of a reference from up to four JPEG frames. Null if Claude isn't configured. */
export async function describeFrames(files: string[], title: string | null): Promise<string | null> {
  const c = claude();
  if (!c || !files.length) return null;
  const images = await Promise.all(files.slice(0, 4).map(async (f) => (await readFile(f)).toString("base64")));
  const res = await c.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    // Thinking can't be turned off on this model; low effort keeps a captioning call quick.
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          ...images.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } })),
          { type: "text", text: DESCRIBE_PROMPT.replace("{TITLE}", title && title !== "Untitled" ? `, titled "${title}"` : "") },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return text || null;
}
