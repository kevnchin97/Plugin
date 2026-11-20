import { describe, expect, it } from "vitest";
import { actionFor, SHORTCUTS } from "./shortcuts";

const KEYS: Record<string, { key: string; code: string }> = {
  Space: { key: " ", code: "Space" },
  J: { key: "j", code: "KeyJ" },
  K: { key: "k", code: "KeyK" },
  L: { key: "l", code: "KeyL" },
  I: { key: "i", code: "KeyI" },
  O: { key: "o", code: "KeyO" },
  S: { key: "s", code: "KeyS" },
  G: { key: "g", code: "KeyG" },
  C: { key: "c", code: "KeyC" },
  "←": { key: "ArrowLeft", code: "ArrowLeft" },
  "→": { key: "ArrowRight", code: "ArrowRight" },
  "[": { key: "[", code: "BracketLeft" },
  "]": { key: "]", code: "BracketRight" },
  Enter: { key: "Enter", code: "Enter" },
  "=": { key: "=", code: "Equal" },
  "-": { key: "-", code: "Minus" },
  Home: { key: "Home", code: "Home" },
  End: { key: "End", code: "End" },
  "?": { key: "?", code: "Slash" },
};

function event(keys: string[]): KeyboardEvent {
  const main = keys[keys.length - 1]!;
  const k = KEYS[main];
  if (!k) throw new Error(`no key mapping for ${main}`);
  return {
    key: k.key,
    code: k.code,
    shiftKey: keys.includes("Shift") || main === "?",
    altKey: keys.includes("Alt"),
    metaKey: false,
    ctrlKey: false,
  } as KeyboardEvent;
}

describe("shortcuts", () => {
  it("every shortcut in the ? overlay triggers its action", () => {
    for (const s of SHORTCUTS) expect(actionFor(event(s.keys)), s.keys.join("+")).toBe(s.action);
  });

  it("covers every key in SPEC §5.1", () => {
    const actions = new Set(SHORTCUTS.map((s) => s.action));
    for (const a of ["playPause", "shuttleBack", "stop", "shuttleForward", "stepBack", "stepForward", "stepBackSecond", "stepForwardSecond", "markIn", "markOut", "clearIn", "clearOut", "prevCut", "nextCut", "still", "gif", "clip", "save"] as const)
      expect(actions.has(a)).toBe(true);
  });

  it("uses physical keys so Alt+I works on macOS (where key is ˆ)", () => {
    expect(actionFor({ key: "ˆ", code: "KeyI", altKey: true, shiftKey: false, metaKey: false, ctrlKey: false } as KeyboardEvent)).toBe("clearIn");
  });

  it("leaves browser shortcuts alone", () => {
    expect(actionFor({ key: "c", code: "KeyC", metaKey: true, altKey: false, shiftKey: false, ctrlKey: false } as KeyboardEvent)).toBeNull();
  });
});
