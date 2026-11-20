import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateGifBytes } from "@innovate/shared";
import { createFilmstrip, createProxy, planFilmstrip, PROXY_MAX_HEIGHT } from "../src/derivatives";
import { exportClip, exportGif, exportStill, sampleGifDensity, type SourceInfo } from "../src/exports";
import { FRAMES_2997_FIXTURE, FRAMES_FIXTURE, fixturePath, lumaForFrame, SCENES_FIXTURE, WEBM_FIXTURE } from "../src/fixtures";
import { probe } from "../src/probe";
import { frameLumas, indexFromLuma, streams, tmp } from "./helpers";

async function source(file: string): Promise<SourceInfo & { durationSec: number }> {
  const p = await probe(file);
  return { fps: p.fps, width: p.width, height: p.height, hasAudio: p.hasAudio, videoStartOffset: p.videoStartOffset, durationSec: p.durationSec };
}

// Each step is 4 luma levels apart, so within ±2 means exactly this frame.
const expectFrame = (luma: number, frame: number) => expect(Math.abs(luma - lumaForFrame(frame))).toBeLessThan(2);

describe("probe", () => {
  it("reads rates, sizes and audio", async () => {
    const p = await probe(fixturePath(FRAMES_2997_FIXTURE.file));
    expect(p.fps).toEqual({ num: 30000, den: 1001 });
    expect(p.width).toBe(320);
    expect(p.hasAudio).toBe(true);
    expect(p.frameCount).toBe(300);
    const w = await probe(fixturePath(WEBM_FIXTURE.file));
    expect(w.videoCodec).toBe("vp9");
    expect(w.frameCount).toBe(50);
  });
});

describe("still", () => {
  it("grabs the exact frame at full resolution", async () => {
    const dir = tmp();
    const file = fixturePath(FRAMES_FIXTURE.file);
    const src = await source(file);
    for (const frame of [0, 1, 37, 100, 249]) {
      const out = join(dir, `s${frame}.png`);
      await exportStill(file, out, frame, src, "png");
      const [luma] = await frameLumas(out);
      expectFrame(luma!, frame);
      const s = await streams(out);
      expect(s.streams[0]).toMatchObject({ codec_name: "png", width: 320, height: 180 });
    }
    const jpg = join(dir, "s.jpg");
    await exportStill(file, jpg, 12, src, "jpg");
    expect((await streams(jpg)).streams[0]!.codec_name).toBe("mjpeg");
  });
});

describe("clip", () => {
  for (const fixture of [FRAMES_FIXTURE.file, FRAMES_2997_FIXTURE.file]) {
    it(`is frame-accurate with audio (${fixture})`, async () => {
      const dir = tmp();
      const file = fixturePath(fixture);
      const src = await source(file);
      for (const [inFrame, outFrame] of [
        [0, 24],
        [40, 89],
        [101, 113],
        [199, 249],
      ] as const) {
        const out = join(dir, `c${inFrame}.mp4`);
        await exportClip(file, out, { inFrame, outFrame }, src);
        const lumas = await frameLumas(out);
        const n = outFrame - inFrame + 1;
        expect(lumas).toHaveLength(n);
        expectFrame(lumas[0]!, inFrame);
        expectFrame(lumas.at(-1)!, outFrame);
        const info = await streams(out);
        const v = info.streams.find((s) => s.codec_type === "video")!;
        const a = info.streams.find((s) => s.codec_type === "audio");
        expect(v.codec_name).toBe("h264");
        expect(a?.codec_name).toBe("aac");
        const expected = (n * src.fps.den) / src.fps.num;
        expect(Math.abs(Number(a!.duration) - expected)).toBeLessThan(0.05);
      }
    });
  }
});

describe("gif", () => {
  it("encodes in two passes at the requested size and frame count", async () => {
    const dir = tmp();
    const file = fixturePath(SCENES_FIXTURE.file);
    const src = await source(file);
    const out = join(dir, "a.gif");
    const options = { width: 320, fps: 10, loop: "loop" as const, quality: 70 };
    const params = await exportGif(file, join(dir, "p.png"), out, { inFrame: 0, outFrame: 49 }, src, options);
    const info = await streams(out);
    expect(info.format.format_name).toBe("gif");
    expect(info.streams[0]).toMatchObject({ codec_name: "gif", width: 320, height: 180 });
    expect(Number(info.streams[0]!.nb_read_frames)).toBe(20);
    expect(params.frames).toBe(20);
    // Palette from pass 1 exists and has at most maxColors entries (palettegen writes 16x16).
    const pal = await streams(join(dir, "p.png"));
    expect(pal.streams[0]).toMatchObject({ width: 16, height: 16 });
    // NETSCAPE2.0 loop extension present => loops forever.
    expect(readFileSync(out).includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  });

  it("estimates size within 0.6-1.6x once the scene's density is sampled", async () => {
    const dir = tmp();
    const file = fixturePath(SCENES_FIXTURE.file);
    const src = await source(file);
    // testsrc2 (moving) and mandelbrot (fine detail) segments.
    for (const scene of [{ startFrame: 0, endFrame: 50 }, { startFrame: 125, endFrame: 165 }]) {
      const density = await sampleGifDensity(file, dir, scene, src);
      for (const options of [
        { width: 640, fps: 15, loop: "loop" as const, quality: 70 },
        { width: 480, fps: 24, loop: "loop" as const, quality: 30 },
      ]) {
        const range = { inFrame: scene.startFrame, outFrame: scene.endFrame - 1 };
        const out = join(dir, `e-${scene.startFrame}-${options.quality}.gif`);
        const params = await exportGif(file, join(dir, "p.png"), out, range, src, options);
        const ratio = estimateGifBytes(params, { density }) / statSync(out).size;
        // Measured: 0.66-1.46x on the grainy demo film, 1.15-1.51x on these clean sources.
        expect(ratio).toBeGreaterThan(0.6);
        expect(ratio).toBeLessThan(1.6);
      }
    }
  });

  it("boomerang plays forward then back without doubled ends", async () => {
    const dir = tmp();
    const file = fixturePath(FRAMES_FIXTURE.file);
    const src = await source(file);
    const out = join(dir, "b.gif");
    await exportGif(file, join(dir, "p.png"), out, { inFrame: 10, outFrame: 19 }, src, { width: 160, fps: 25, loop: "boomerang", quality: 100 });
    const lumas = await frameLumas(out);
    const idx = lumas.map(indexFromLuma);
    expect(idx).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
  });
});

describe("proxy and filmstrip", () => {
  it("keeps every frame on the same grid and scales down", async () => {
    const dir = tmp();
    const file = fixturePath(FRAMES_FIXTURE.file);
    const src = await source(file);
    const proxy = join(dir, "proxy.mp4");
    await createProxy(file, proxy, { hasAudio: true, durationSec: src.durationSec });
    const lumas = await frameLumas(proxy);
    expect(lumas).toHaveLength(250);
    // Proxy is lossy; still close enough to identify each frame.
    [0, 1, 54, 55, 123, 249].forEach((f) => expectFrame(lumas[f]!, f));
    const info = await streams(proxy);
    expect(info.streams.find((s) => s.codec_type === "video")!.height).toBeLessThanOrEqual(PROXY_MAX_HEIGHT);
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
  });

  it("builds a sprite sheet matching its plan", async () => {
    const dir = tmp();
    const file = fixturePath(SCENES_FIXTURE.file);
    const src = await source(file);
    const plan = planFilmstrip(src.durationSec, src.width, src.height);
    expect(plan.interval).toBe(0.25);
    expect(plan.count).toBe(36);
    const out = join(dir, "strip.jpg");
    await createFilmstrip(file, out, plan, { durationSec: src.durationSec });
    const info = await streams(out);
    expect(info.streams[0]).toMatchObject({ width: plan.columns * plan.tileWidth, height: plan.rows * plan.tileHeight });
  });

  it("plans long videos with a coarser interval", () => {
    expect(planFilmstrip(180, 1920, 1080)).toMatchObject({ interval: 0.5, count: 360, tileWidth: 192, tileHeight: 108 });
    expect(planFilmstrip(3600, 1920, 1080).count).toBeLessThanOrEqual(360);
  });
});
