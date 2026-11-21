import { describe, expect, it } from "vitest";
import { saveDeckSchema, savePortfolioSchema, saveReelSchema, slugSchema, TREATMENT_TEMPLATE, trimmedDuration } from "../src/present";

describe("reel trims", () => {
  it("clamps trims to the clip and never goes negative", () => {
    expect(trimmedDuration({ inSec: null, outSec: null }, 8)).toBe(8);
    expect(trimmedDuration({ inSec: 1, outSec: 3 }, 8)).toBe(2);
    expect(trimmedDuration({ inSec: 6, outSec: 20 }, 8)).toBe(2);
    expect(trimmedDuration({ inSec: 9, outSec: null }, 8)).toBe(0);
  });
  it("rejects an out point before the in point", () => {
    const id = crypto.randomUUID();
    const r = saveReelSchema.safeParse({ title: "R", items: [{ id, referenceId: id, inSec: 3, outSec: 1 }] });
    expect(r.success).toBe(false);
  });
});

describe("portfolio", () => {
  it("normalises and validates the address", () => {
    expect(slugSchema.parse("  Jane-Doe ")).toBe("jane-doe");
    for (const bad of ["ab", "-jane", "jane-", "jane doe", "api", "s"]) expect(slugSchema.safeParse(bad).success, bad).toBe(false);
  });
  it("takes one reference or one reel per item, and http(s) websites only", () => {
    const id = crypto.randomUUID();
    expect(savePortfolioSchema.safeParse({ slug: "jane", items: [{ referenceId: id, reelId: id }] }).success).toBe(false);
    expect(savePortfolioSchema.safeParse({ slug: "jane", items: [{}] }).success).toBe(false);
    expect(savePortfolioSchema.safeParse({ slug: "jane", website: "javascript:alert(1)", items: [] }).success).toBe(false);
    expect(savePortfolioSchema.parse({ slug: "jane", website: "https://example.com", items: [{ reelId: id }] }).items[0]).toEqual({ referenceId: null, reelId: id, caption: "" });
  });
});

describe("decks", () => {
  it("the treatment template covers SPEC §5.5's sections", () => {
    expect(TREATMENT_TEMPLATE.map((t) => t.section)).toEqual(["title", "logline", "tone", "look", "characters", "locations", "shots"]);
  });
  it("caps media per slide", () => {
    const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
    expect(saveDeckSchema.safeParse({ title: "D", theme: "paper", slides: [{ id: ids[0], layout: "grid", mediaIds: ids }] }).success).toBe(false);
  });
});
