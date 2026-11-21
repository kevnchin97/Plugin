import { afterAll, describe, expect, it } from "vitest";

const { closeDb } = await import("@innovate/db");
const { runTool, TOOL_PARAMS } = await import("../src/agent/tools");

describe("agent tools", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("exposes Innovate's operations as JSON-schema tools, with changes only as proposals", () => {
    const names = TOOL_PARAMS.map((t) => t.name);
    expect(names).toEqual([
      "search_library",
      "list_boards",
      "get_board",
      "recent_uploads",
      "get_scenes",
      "search_vimeo",
      "ingest_link",
      "propose_create_board",
      "propose_add_to_board",
      "propose_save_links",
      "propose_export_clips",
      "propose_create_deck",
      "propose_create_reel",
    ]);
    for (const t of TOOL_PARAMS) {
      expect(t.input_schema.type, t.name).toBe("object");
      expect(t.description!.length, t.name).toBeGreaterThan(20);
    }
    const saveLinks = TOOL_PARAMS.find((t) => t.name === "propose_save_links")!.input_schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(saveLinks.properties)).toEqual(["target", "picks"]); // the action "type" is implied by the tool
    expect(saveLinks.required).toEqual(["target", "picks"]);
  });

  it("rejects bad input and ids from other workspaces with readable errors", async () => {
    const ctx = { workspaceId: crypto.randomUUID(), userId: null, taskId: crypto.randomUUID(), actions: [], signal: new AbortController().signal };
    const bad = await runTool("propose_create_board", { title: "" }, ctx);
    expect(bad.ok).toBe(false);
    const foreign = await runTool("propose_create_board", { title: "Mood", referenceIds: [crypto.randomUUID()] }, ctx);
    expect(foreign).toMatchObject({ ok: false, error: expect.stringContaining("aren't in this workspace") });
    expect(ctx.actions).toHaveLength(0);
    expect(await runTool("nope", {}, ctx)).toEqual({ ok: false, error: "Unknown tool nope." });
  });
});
