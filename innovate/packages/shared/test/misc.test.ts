import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportFilename, slugify } from "../src/filename";
import { estimateGifBytes, resolveGifParams } from "../src/gif";
import { exportRequestSchema } from "../src/schemas";
import { parseMentions } from "../src/feedback";
import { renderTokensCss } from "../src/tokens";

describe("filenames", () => {
  it("matches the SPEC pattern", () => {
    expect(exportFilename("Source Title.mov", "gif", 12.4, 15.9)).toBe("source-title_00m12s-00m15s.gif");
    expect(exportFilename("Night Exteriors — Take 3", "png", 75)).toBe("night-exteriors-take-3_01m15s.png");
    expect(slugify("!!!")).toBe("innovate");
  });
});

describe("gif params", () => {
  it("never upscales and keeps even dimensions", () => {
    const p = resolveGifParams({ width: 1080, fps: 30, loop: "loop", quality: 70 }, { width: 640, height: 360, fps: 25 }, 2);
    expect(p).toMatchObject({ width: 640, height: 360, fps: 25, frames: 50 });
    const q = resolveGifParams({ width: 481, fps: 15, loop: "boomerang", quality: 10 }, { width: 1920, height: 817, fps: 24 }, 2);
    expect(q.width % 2).toBe(0);
    expect(q.height % 2).toBe(0);
    expect(q.frames).toBe(58);
  });

  it("estimates grow with size, frames and quality", () => {
    const src = { width: 1920, height: 1080, fps: 25 };
    for (const opts of [{}, { density: { first: 0.6, perFrame: 0.3 } }]) {
      const small = estimateGifBytes(resolveGifParams({ width: 320, fps: 10, loop: "loop", quality: 20 }, src, 3), opts);
      const big = estimateGifBytes(resolveGifParams({ width: 800, fps: 24, loop: "loop", quality: 90 }, src, 3), opts);
      expect(big).toBeGreaterThan(small * 5);
    }
  });
});

describe("export schema", () => {
  it("rejects inverted ranges", () => {
    const id = "6f1c3a52-6a39-4d4a-9a53-3f0b3cd4a0a1";
    expect(exportRequestSchema.safeParse({ kind: "clip", referenceId: id, inFrame: 10, outFrame: 5 }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ kind: "clip", referenceId: id, inFrame: 5, outFrame: 10 }).success).toBe(true);
  });
});

describe("design tokens", () => {
  it("tokens.css is up to date (run `pnpm tokens`)", () => {
    const onDisk = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    expect(onDisk).toBe(renderTokensCss());
  });
});

describe("mentions", () => {
  it("finds @names, ignores emails", () => {
    expect(parseMentions("@Ana love this, cc @ben.k and me@example.com @Ana")).toEqual(["Ana", "ben.k"]);
  });
});
