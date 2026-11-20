import { describe, expect, it } from "vitest";
import {
  formatTimecode,
  frameSeekTime,
  frameToSeconds,
  parseFrameRate,
  parseTimecode,
  secondsToFrame,
} from "../src/timecode";

const pal = { num: 25, den: 1 };
const ntsc = { num: 30000, den: 1001 };

describe("timecode", () => {
  it("formats HH:MM:SS:FF", () => {
    expect(formatTimecode(0, pal)).toBe("00:00:00:00");
    expect(formatTimecode(24, pal)).toBe("00:00:00:24");
    expect(formatTimecode(25, pal)).toBe("00:00:01:00");
    expect(formatTimecode(25 * 3661 + 7, pal)).toBe("01:01:01:07");
    expect(formatTimecode(29, ntsc)).toBe("00:00:00:29");
    expect(formatTimecode(30, ntsc)).toBe("00:00:01:00");
  });

  it("round-trips through parseTimecode", () => {
    for (const f of [0, 1, 24, 25, 1499, 90001]) expect(parseTimecode(formatTimecode(f, pal), pal)).toBe(f);
    expect(parseTimecode("00:00:00:25", pal)).toBeNull();
    expect(parseTimecode("nope", pal)).toBeNull();
  });

  it("maps frames and seconds exactly, including 29.97", () => {
    for (let f = 0; f < 2000; f += 7) {
      expect(secondsToFrame(frameToSeconds(f, ntsc), ntsc)).toBe(f);
      expect(secondsToFrame(frameSeekTime(f, ntsc), ntsc)).toBe(f);
      expect(secondsToFrame(frameToSeconds(f, pal), pal)).toBe(f);
    }
  });

  it("parses ffprobe rates", () => {
    expect(parseFrameRate("30000/1001")).toEqual(ntsc);
    expect(parseFrameRate("25")).toEqual({ num: 25, den: 1 });
    expect(parseFrameRate("0/0")).toEqual({ num: 25, den: 1 });
  });
});
