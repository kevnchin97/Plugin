/**
 * Deterministic test media (SPEC §8), generated with ffmpeg's lavfi sources. No downloaded
 * media anywhere: everything here is synthetic and royalty-free.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFfmpeg } from "./run";

export const FIXTURES_DIR = process.env.INNOVATE_FIXTURES_DIR || fileURLToPath(new URL("../../../fixtures", import.meta.url));

/**
 * scenes.mp4: 640x360 @ 25 fps, 8.8 s, 440 Hz tone. Five segments of known length:
 *   testsrc2 2.0s | smptehdbars 3.0s | mandelbrot 1.6s | white flash 0.2s | testsrc 2.0s
 * Cuts at frames 50, 125, 165, 170. 165 and 170 are 5 frames apart, under the 0.5 s
 * minimum shot, so they merge into one: expect 4 scenes.
 */
export const SCENES_FIXTURE = {
  file: "scenes.mp4",
  fps: 25,
  width: 640,
  height: 360,
  frames: 220,
  segments: [
    { src: "testsrc2", seconds: 2.0 },
    { src: "smptehdbars", seconds: 3.0 },
    { src: "mandelbrot", seconds: 1.6 },
    { src: "color=c=white", seconds: 0.2 },
    { src: "testsrc", seconds: 2.0 },
  ],
  cuts: [50, 125, 165, 170],
  expectedCuts: [50, 125],
  flashCuts: [165, 170],
};

/**
 * frames.mp4: 320x180 @ 25 fps, 10 s, lossless. Frame n is flat grey with luma 16 + 4*(n mod 55)
 * so any decoded frame tells you its index (mod 55). Has a tone track.
 * frames2997.mov: same idea at 30000/1001 in a MOV with a 1/600 timebase, which forces
 * timestamp rounding, the classic cause of off-by-one trims.
 */
export const FRAMES_FIXTURE = { file: "frames.mp4", fps: 25, frames: 250, width: 320, height: 180 };
export const FRAMES_2997_FIXTURE = { file: "frames2997.mov", fpsNum: 30000, fpsDen: 1001, frames: 300, width: 320, height: 180 };
export const lumaForFrame = (n: number) => 16 + 4 * (n % 55);

/**
 * vfr.mp4: phone-style variable frame rate. Nominal 30 fps, but every 7th frame is missing
 * (as if dropped under load). Frame n of the 30 fps capture keeps its luma 16 + 4*(n mod 55).
 */
export const VFR_FIXTURE = { file: "vfr.mp4", nominalFps: 30, captureFrames: 150, droppedEvery: 7, droppedPhase: 3 };

/** demo.mp4: a ~16 s "film" of generated shots with grain and a chord pad, for the seed and screenshots. */
export const DEMO_FIXTURE = { file: "demo.mp4" };

/** short.webm: 2 s VP9 + Opus, to cover the WebM upload path. */
export const WEBM_FIXTURE = { file: "short.webm" };

function sourceSegment(src: string, seconds: number, w: number, h: number, fps: number): string {
  const size = `s=${w}x${h}`;
  const opts = src.includes("=") ? `${src}:${size}:r=${fps}:d=${seconds}` : `${src}=${size}:r=${fps}:d=${seconds}`;
  return src === "mandelbrot" ? `mandelbrot=${size}:r=${fps},trim=duration=${seconds}` : opts;
}

async function makeScenes(out: string) {
  const f = SCENES_FIXTURE;
  const inputs = f.segments.map((s, i) => `${sourceSegment(s.src, s.seconds, f.width, f.height, f.fps)},format=yuv420p,setsar=1,settb=1/${f.fps}[v${i}]`);
  const concat = f.segments.map((_, i) => `[v${i}]`).join("") + `concat=n=${f.segments.length}:v=1:a=0[v]`;
  const total = f.frames / f.fps;
  await runFfmpeg([
    "-filter_complex",
    `${inputs.join(";")};${concat};sine=frequency=440:sample_rate=48000:duration=${total},volume=0.3[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-g",
    "50",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    out,
  ]);
}

async function makeFrames(out: string, rate: string, frames: number, extra: string[]) {
  const { width: w, height: h } = FRAMES_FIXTURE;
  const [n, d] = rate.split("/").map(Number) as [number, number];
  const seconds = (frames * (d ?? 1)) / n;
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${w}x${h}:r=${rate},format=yuv420p,geq=lum='16+4*mod(N\\,55)':cb=128:cr=128`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=330:sample_rate=48000`,
    "-frames:v",
    String(frames),
    "-t",
    seconds.toFixed(6),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-qp",
    "0",
    "-g",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    ...extra,
    out,
  ]);
}

async function makeVfr(out: string) {
  const f = VFR_FIXTURE;
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=320x180:r=${f.nominalFps},format=yuv420p,geq=lum='16+4*mod(N\\,55)':cb=128:cr=128,trim=end_frame=${f.captureFrames},select='not(eq(mod(n\\,${f.droppedEvery})\\,${f.droppedPhase}))'`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:sample_rate=48000",
    "-t",
    String(f.captureFrames / f.nominalFps),
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-qp",
    "0",
    "-c:a",
    "aac",
    "-video_track_timescale",
    "90000",
    out,
  ]);
}

async function makeDemo(out: string) {
  const W = 1280;
  const H = 720;
  const R = 24;
  const shots = [
    // Dusk: slow warm gradient drift.
    `gradients=s=${W}x${H}:r=${R}:c0=0x081226:c1=0x2a1a4a:c2=0xe0783a:c3=0xffc46b:n=4:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.012:type=radial,trim=duration=3.5`,
    // Neon: fast cool sweep.
    `gradients=s=${W}x${H}:r=${R}:c0=0x05060f:c1=0x0b5a73:c2=0xff2e88:n=3:speed=0.05:type=linear,trim=duration=3`,
    // Cells: game of life, upscaled with hard pixels, amber on night.
    `life=s=320x180:r=${R}:mold=12:ratio=0.12:death_color=#0b0b16:life_color=#ffb35c:mold_color=#3a1f5c,scale=${W}:${H}:flags=neighbor,trim=duration=3`,
    // Push-in: mandelbrot zoom, desaturated and graded teal.
    `mandelbrot=s=${W}x${H}:r=${R}:inner=convergence:outer=normalized_iteration_count,hue=s=0.35,colorbalance=bs=0.22:rh=-0.08:bh=0.05,trim=duration=3.5`,
    // Ember: dark radial with flicker.
    `gradients=s=${W}x${H}:r=${R}:c0=0x020202:c1=0x3b0d05:c2=0xb3361a:n=3:speed=0.03:type=circular,trim=duration=3`,
  ];
  const graph = shots.map((s, i) => `${s},format=yuv420p,setsar=1,settb=1/${R}[s${i}]`).join(";");
  const concat = shots.map((_, i) => `[s${i}]`).join("") + `concat=n=${shots.length}:v=1:a=0,noise=alls=10:allf=t,vignette=PI/4.5[v]`;
  const total = 16;
  const pad =
    "aevalsrc='0.08*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.05*sin(2*PI*164.81*t)+0.04*sin(2*PI*220*t)+0.03*sin(2*PI*277.18*t)*(0.5+0.5*sin(2*PI*0.5*t))'" +
    `:s=48000:d=${total},afade=t=in:d=1,afade=t=out:st=${total - 1.5}:d=1.5[a]`;
  await runFfmpeg([
    "-filter_complex",
    `${graph};${concat};${pad}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    out,
  ]);
}

async function makeWebm(out: string) {
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=25:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=520:sample_rate=48000:duration=2",
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "300k",
    "-deadline",
    "realtime",
    "-c:a",
    "libopus",
    out,
  ]);
}

export async function ensureFixtures(opts: { force?: boolean; only?: string[]; log?: (m: string) => void } = {}) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const jobs: [string, (out: string) => Promise<void>][] = [
    [SCENES_FIXTURE.file, makeScenes],
    [FRAMES_FIXTURE.file, (o) => makeFrames(o, "25", FRAMES_FIXTURE.frames, [])],
    [FRAMES_2997_FIXTURE.file, (o) => makeFrames(o, "30000/1001", FRAMES_2997_FIXTURE.frames, ["-video_track_timescale", "600"])],
    [VFR_FIXTURE.file, makeVfr],
    [DEMO_FIXTURE.file, makeDemo],
    [WEBM_FIXTURE.file, makeWebm],
  ];
  for (const [name, make] of jobs) {
    if (opts.only && !opts.only.includes(name)) continue;
    const out = join(FIXTURES_DIR, name);
    if (!opts.force && existsSync(out)) continue;
    opts.log?.(`generating ${name}`);
    await make(out);
  }
  return FIXTURES_DIR;
}

export const fixturePath = (name: string) => join(FIXTURES_DIR, name);
