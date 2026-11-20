import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseMasterRate, createMaster } from "../src/master";
import { exportClip, exportStill } from "../src/exports";
import { fixturePath, lumaForFrame, VFR_FIXTURE } from "../src/fixtures";
import { probe } from "../src/probe";
import { frameLumas, indexFromLuma, tmp } from "./helpers";

describe("chooseMasterRate", () => {
  it("uses a standard nominal capture rate", () => {
    expect(chooseMasterRate({ nominalFps: { num: 30, den: 1 }, avgFps: { num: 129, den: 5 } })).toEqual({ num: 30, den: 1 });
    expect(chooseMasterRate({ nominalFps: { num: 60000, den: 1001 }, avgFps: { num: 5832, den: 100 } })).toEqual({ num: 60000, den: 1001 });
  });

  it("snaps the average when the nominal rate is meaningless", () => {
    // Some containers report a timebase-like nominal rate (e.g. 90000/1).
    expect(chooseMasterRate({ nominalFps: { num: 90000, den: 1 }, avgFps: { num: 2985, den: 100 } })).toEqual({ num: 30000, den: 1001 });
    expect(chooseMasterRate({ nominalFps: { num: 600, den: 1 }, avgFps: { num: 1712, den: 100 } })).toEqual({ num: 17120, den: 1000 });
  });
});

describe("CFR master from variable-frame-rate footage", () => {
  it("puts every frame on a fixed grid, filling gaps with neighbours", async () => {
    const dir = tmp();
    const src = fixturePath(VFR_FIXTURE.file);
    const info = await probe(src);
    expect(info.variableFrameRate).toBe(true);
    const rate = chooseMasterRate(info);
    expect(rate).toEqual({ num: 30, den: 1 });

    const master = join(dir, "master.mp4");
    await createMaster(src, master, rate, { hasAudio: info.hasAudio, durationSec: info.durationSec });
    const m = await probe(master);
    expect(m.variableFrameRate).toBe(false);
    expect(m.fps).toEqual({ num: 30, den: 1 });
    expect(m.hasAudio).toBe(true);
    expect(Math.abs(m.frameCount - VFR_FIXTURE.captureFrames)).toBeLessThanOrEqual(1);

    const lumas = await frameLumas(master);
    const dropped = (n: number) => n % VFR_FIXTURE.droppedEvery === VFR_FIXTURE.droppedPhase;
    for (let i = 0; i < Math.min(lumas.length, VFR_FIXTURE.captureFrames); i++) {
      const got = indexFromLuma(lumas[i]!);
      // Captured frames land exactly on their slot; a missing slot shows a neighbour.
      if (dropped(i)) expect([(i - 1) % 55, (i + 1) % 55]).toContain(got);
      else expect(Math.abs(lumas[i]! - lumaForFrame(i))).toBeLessThan(2);
    }

    // Exports from the master are frame-exact on the 30 fps grid.
    const clip = join(dir, "clip.mp4");
    await exportClip(master, clip, { inFrame: 40, outFrame: 59 }, { fps: m.fps, width: m.width, height: m.height, hasAudio: true });
    const clipLumas = await frameLumas(clip);
    expect(clipLumas).toHaveLength(20);
    expect(Math.abs(clipLumas[0]! - lumaForFrame(40))).toBeLessThan(2);
    const still = join(dir, "still.png");
    await exportStill(master, still, 100, { fps: m.fps, width: m.width, height: m.height, hasAudio: true }, "png");
    expect(Math.abs((await frameLumas(still))[0]! - lumaForFrame(100))).toBeLessThan(2);
  });
});
