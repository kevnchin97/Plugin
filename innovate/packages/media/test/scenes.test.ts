import { describe, expect, it } from "vitest";
import { buildScenes, detectCuts, detectScenes, type FrameStat, parseFrameStats, scoreScene } from "../src/scenes";
import { fixturePath, SCENES_FIXTURE } from "../src/fixtures";
import { createProxy } from "../src/derivatives";
import { probe } from "../src/probe";
import { join } from "node:path";
import { tmp } from "./helpers";

const fps = { num: 25, den: 1 };
const stat = (frame: number, scene: number, ydif = 0): FrameStat => ({ frame, time: frame / 25, scene, ydif, contrast: 100 });

describe("parseFrameStats", () => {
  it("reads ffmpeg metadata print output", () => {
    const text = [
      "frame:0    pts:0       pts_time:0",
      "lavfi.scene_score=0.000000",
      "lavfi.signalstats.YLOW=16",
      "lavfi.signalstats.YHIGH=235",
      "lavfi.signalstats.YDIF=0.000000",
      "frame:1    pts:512     pts_time:0.04",
      "lavfi.scene_score=0.812000",
      "lavfi.signalstats.YLOW=40",
      "lavfi.signalstats.YHIGH=60",
      "lavfi.signalstats.YDIF=12.5",
    ].join("\n");
    expect(parseFrameStats(text)).toEqual([
      { frame: 0, time: 0, scene: 0, ydif: 0, contrast: 219 },
      { frame: 1, time: 0.04, scene: 0.812, ydif: 12.5, contrast: 20 },
    ]);
  });
});

describe("detectCuts", () => {
  const opts = { threshold: 0.3, spikeRatio: 2.5, minShotFrames: 12 };

  it("finds isolated spikes", () => {
    const stats = Array.from({ length: 100 }, (_, i) => stat(i, i === 40 || i === 70 ? 0.9 : 0.01));
    expect(detectCuts(stats, opts)).toEqual([40, 70]);
  });

  it("merges cuts closer than the minimum shot, keeping the stronger", () => {
    const stats = Array.from({ length: 100 }, (_, i) => stat(i, i === 40 ? 0.6 : i === 45 ? 0.95 : 0.01));
    expect(detectCuts(stats, opts)).toEqual([45]);
  });

  it("ignores cuts that would leave a sliver at either end", () => {
    const stats = Array.from({ length: 100 }, (_, i) => stat(i, i === 5 || i === 95 ? 0.9 : 0.01));
    expect(detectCuts(stats, opts)).toEqual([]);
  });

  it("rejects high scores during sustained fast motion", () => {
    const stats = Array.from({ length: 100 }, (_, i) => stat(i, i > 30 && i < 60 ? 0.35 + (i % 3) * 0.02 : 0.01));
    expect(detectCuts(stats, opts)).toEqual([]);
  });
});

describe("scoring", () => {
  it("prefers motion, contrast and a usable length", () => {
    expect(scoreScene(10, 180, 4)).toBeGreaterThan(scoreScene(0, 180, 4));
    expect(scoreScene(10, 180, 4)).toBeGreaterThan(scoreScene(10, 20, 4));
    expect(scoreScene(10, 180, 4)).toBeGreaterThan(scoreScene(10, 180, 0.4));
  });

  it("builds contiguous scenes with ranks", () => {
    const stats = Array.from({ length: 100 }, (_, i) => stat(i, 0, i >= 40 ? 8 : 0));
    const scenes = buildScenes(stats, [40], fps);
    expect(scenes.map((s) => [s.startFrame, s.endFrame])).toEqual([
      [0, 40],
      [40, 100],
    ]);
    expect(scenes[1]!.rank).toBe(0);
    expect(scenes[1]!.start).toBeCloseTo(1.6);
  });
});

describe("detectScenes on the generated fixture", () => {
  it("cuts at the known frames (±1) and merges the flash", async () => {
    const dir = tmp();
    const src = fixturePath(SCENES_FIXTURE.file);
    const info = await probe(src);
    const proxy = join(dir, "proxy.mp4");
    await createProxy(src, proxy, { hasAudio: info.hasAudio, durationSec: info.durationSec });
    const { scenes, stats } = await detectScenes(proxy, info.fps, { durationSec: info.durationSec });

    expect(stats.length).toBe(SCENES_FIXTURE.frames);
    expect(scenes).toHaveLength(4);
    const cuts = scenes.slice(1).map((s) => s.startFrame);
    expect(Math.abs(cuts[0]! - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(cuts[1]! - 125)).toBeLessThanOrEqual(1);
    expect(SCENES_FIXTURE.flashCuts.some((c) => Math.abs(cuts[2]! - c) <= 1)).toBe(true);
    expect(scenes.at(-1)!.endFrame).toBe(SCENES_FIXTURE.frames);
    // Ranks are a permutation, best first.
    expect(scenes.map((s) => s.rank).sort()).toEqual([0, 1, 2, 3]);
    // Static colour bars are the least worth saving.
    expect(scenes[1]!.rank).toBe(3);
  });
});

describe("parallel single-decode analysis", () => {
  for (const segments of [1, 3]) {
    it(`matches the reference passes with ${segments} chunk(s): cuts, every frame, audio, filmstrip`, async () => {
      const { analyzeSource, planFilmstrip } = await import("../src/derivatives");
      const { runFfprobe } = await import("../src/run");
      const dir = tmp();
      const src = fixturePath(SCENES_FIXTURE.file);
      const info = await probe(src);
      const plan = planFilmstrip(info.durationSec, info.width, info.height);
      const out = { proxy: join(dir, "p.mp4"), filmstrip: join(dir, "f.jpg") };
      const { scenes, stats } = await analyzeSource(src, out, {
        hasAudio: true,
        durationSec: info.durationSec,
        fps: info.fps,
        frameCount: info.frameCount,
        plan,
        segments,
        minSegmentSeconds: 1,
        workDir: join(dir, "work"),
      });
      expect(stats).toHaveLength(SCENES_FIXTURE.frames);
      expect(stats.map((s) => s.frame)).toEqual([...Array(SCENES_FIXTURE.frames).keys()]);
      expect(scenes).toHaveLength(4);
      expect(scenes.slice(1, 3).map((s) => s.startFrame)).toEqual([50, 125]);
      const p = await probe(out.proxy);
      expect(p.frameCount).toBe(SCENES_FIXTURE.frames);
      expect(p.variableFrameRate).toBe(false);
      expect(p.hasAudio).toBe(true);
      expect(Math.abs(p.durationSec - info.durationSec)).toBeLessThan(0.1);
      const strip = JSON.parse(await runFfprobe(["-print_format", "json", "-show_streams", out.filmstrip])) as { streams: { width: number; height: number }[] };
      expect(strip.streams[0]).toMatchObject({ width: plan.columns * plan.tileWidth, height: plan.rows * plan.tileHeight });
    });
  }

  it("keeps frame identity across chunk boundaries, and finds a cut sitting exactly on one", async () => {
    const { analyzeSource, planFilmstrip, planSegments } = await import("../src/derivatives");
    const { frameLumas } = await import("./helpers");
    const { FRAMES_FIXTURE, lumaForFrame } = await import("../src/fixtures");
    const dir = tmp();
    const src = fixturePath(FRAMES_FIXTURE.file);
    const info = await probe(src);
    // 250 frames in 5 chunks -> boundaries at 50, 100, 150, 200.
    expect(planSegments(250, info.fps, 5, 1).map((s) => s.start)).toEqual([0, 50, 100, 150, 200]);
    const out = { proxy: join(dir, "p.mp4"), filmstrip: join(dir, "f.jpg") };
    const plan = planFilmstrip(info.durationSec, info.width, info.height);
    const { stats } = await analyzeSource(src, out, {
      hasAudio: true, durationSec: info.durationSec, fps: info.fps, frameCount: info.frameCount, plan, segments: 5, minSegmentSeconds: 1, workDir: join(dir, "w"),
    });
    const lumas = await frameLumas(out.proxy);
    expect(lumas).toHaveLength(250);
    for (const f of [0, 49, 50, 51, 99, 100, 150, 199, 200, 249]) expect(Math.abs(lumas[f]! - lumaForFrame(f))).toBeLessThan(2);
    // Every frame differs from the previous one, including the first frame of each chunk.
    for (const f of [50, 100, 150, 200]) expect(stats[f]!.scene).toBeGreaterThan(0);
  });
});
