import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runFfmpeg } from "@innovate/media";

const { embedImageFile, embedTexts, meanVector, normalize } = await import("../src/clip");

const ROOT = resolve(import.meta.dirname, "../../..");
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe("vector helpers", () => {
  it("normalises and averages", () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    const a = new Array(512).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const b = new Array(512).fill(0).map((_, i) => (i === 1 ? 1 : 0));
    const m = meanVector([a, b]);
    expect(m[0]).toBeCloseTo(Math.SQRT1_2);
    expect(dot(m, m)).toBeCloseTo(1);
  });
});

// Loads CLIP (downloads ~150 MB into MODEL_CACHE_DIR the first time).
describe("CLIP ranking on the demo film", () => {
  it("matches descriptions to the right shot", { timeout: 300_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "innovate-clip-"));
    const shots = { dusk: 1.5, neon: 5, cells: 8 };
    const frames: Record<string, number[]> = {};
    for (const [name, t] of Object.entries(shots)) {
      const out = join(dir, `${name}.jpg`);
      await runFfmpeg(["-y", "-ss", String(t), "-i", join(ROOT, "fixtures/demo.mp4"), "-frames:v", "1", "-vf", "scale=448:-2", out]);
      frames[name] = await embedImageFile(out);
    }
    const queries = { dusk: "warm orange sunset glow", neon: "pink and teal neon light", cells: "scattered golden dots on purple" };
    const vecs = await embedTexts(Object.values(queries));
    Object.keys(queries).forEach((expected, i) => {
      const best = Object.entries(frames).sort((a, b) => dot(b[1], vecs[i]!) - dot(a[1], vecs[i]!))[0]![0];
      expect(best, `"${Object.values(queries)[i]}"`).toBe(expected);
    });
  });
});
