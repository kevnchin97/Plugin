import { describe, expect, it } from "vitest";
import { formatShotDuration, shotsToCsv } from "../src/shots";

describe("shot list CSV", () => {
  it("quotes, escapes and neutralises formulas", () => {
    const csv = shotsToCsv([
      { number: "1", scene: "3", setting: "Cabin, night", description: 'She says "stay"\nthen leaves', framing: "CU", movement: "Push-in", lens: "50mm", rig: "Dolly", durationSec: 4.5, status: "approved", motion: { title: "Slow push-in", url: "https://x/s#1" } },
      { number: "2", scene: "", setting: "", description: "=HYPERLINK(evil)", framing: null, movement: "", lens: "", rig: "", durationSec: null, status: "idea", motion: null },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("#,Scene,Setting,Description,Framing,Movement,Lens,Rig,Duration (s),Status,Motion reference,Motion link");
    expect(csv).toContain('"Cabin, night","She says ""stay""\nthen leaves",CU,Push-in,50mm,Dolly,4.5,approved,Slow push-in,https://x/s#1');
    expect(csv).toContain("2,,,'=HYPERLINK(evil),,,,,,idea,,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("formats durations", () => {
    expect(formatShotDuration(4.25)).toBe("4.3s");
    expect(formatShotDuration(75)).toBe("1m 15s");
    expect(formatShotDuration(null)).toBe("");
  });
});
