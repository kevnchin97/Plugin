/** Single source of truth for keyboard shortcuts: the editor keymap and the ? overlay both read this. */
export type ShortcutAction =
  | "playPause"
  | "shuttleBack"
  | "stop"
  | "shuttleForward"
  | "stepBack"
  | "stepForward"
  | "stepBackSecond"
  | "stepForwardSecond"
  | "markIn"
  | "markOut"
  | "clearIn"
  | "clearOut"
  | "prevCut"
  | "nextCut"
  | "still"
  | "gif"
  | "clip"
  | "save"
  | "zoomIn"
  | "zoomOut"
  | "home"
  | "end"
  | "help";

export interface Shortcut {
  action: ShortcutAction;
  keys: string[];
  label: string;
  group: "Playback" | "Navigate" | "Marks" | "Export" | "View";
}

export const SHORTCUTS: Shortcut[] = [
  { action: "playPause", keys: ["Space"], label: "Play / pause", group: "Playback" },
  { action: "shuttleBack", keys: ["J"], label: "Shuttle back (tap again to speed up)", group: "Playback" },
  { action: "stop", keys: ["K"], label: "Stop", group: "Playback" },
  { action: "shuttleForward", keys: ["L"], label: "Shuttle forward (tap again to speed up)", group: "Playback" },
  { action: "stepBack", keys: ["←"], label: "Back one frame", group: "Navigate" },
  { action: "stepForward", keys: ["→"], label: "Forward one frame", group: "Navigate" },
  { action: "stepBackSecond", keys: ["Shift", "←"], label: "Back one second", group: "Navigate" },
  { action: "stepForwardSecond", keys: ["Shift", "→"], label: "Forward one second", group: "Navigate" },
  { action: "prevCut", keys: ["["], label: "Previous cut", group: "Navigate" },
  { action: "nextCut", keys: ["]"], label: "Next cut", group: "Navigate" },
  { action: "home", keys: ["Home"], label: "Go to start", group: "Navigate" },
  { action: "end", keys: ["End"], label: "Go to end", group: "Navigate" },
  { action: "markIn", keys: ["I"], label: "Set in point", group: "Marks" },
  { action: "markOut", keys: ["O"], label: "Set out point", group: "Marks" },
  { action: "clearIn", keys: ["Alt", "I"], label: "Clear in point", group: "Marks" },
  { action: "clearOut", keys: ["Alt", "O"], label: "Clear out point", group: "Marks" },
  { action: "still", keys: ["S"], label: "Grab a still of this frame", group: "Export" },
  { action: "gif", keys: ["G"], label: "Make a GIF of the range", group: "Export" },
  { action: "clip", keys: ["C"], label: "Export the range as a clip", group: "Export" },
  { action: "save", keys: ["Enter"], label: "Save the latest export to the library", group: "Export" },
  { action: "zoomIn", keys: ["="], label: "Zoom timeline in", group: "View" },
  { action: "zoomOut", keys: ["-"], label: "Zoom timeline out", group: "View" },
  { action: "help", keys: ["?"], label: "Show this list", group: "View" },
];

/** App-wide shortcuts (handled in components/shell/HeaderSearch.tsx and the agent bar). */
export const GLOBAL_SHORTCUTS: { keys: string[]; label: string }[] = [{ keys: ["/"], label: "Search the library" }];

/** Board canvas shortcuts (shown in the ? overlay; handled in components/board/BoardCanvas.tsx). */
export const BOARD_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["N"], label: "New note" },
  { keys: ["Enter"], label: "Edit note or link, open board" },
  { keys: ["Delete"], label: "Delete selection" },
  { keys: ["←", "→", "↑", "↓"], label: "Nudge (Shift: further)" },
  { keys: ["⌘", "A"], label: "Select all" },
  { keys: ["⌘", "D"], label: "Duplicate" },
  { keys: ["⌘", "Z"], label: "Undo" },
  { keys: ["⇧", "⌘", "Z"], label: "Redo" },
  { keys: ["Space"], label: "Hold and drag to pan" },
  { keys: ["=", "-", "0"], label: "Zoom in, out, reset" },
  { keys: ["Esc"], label: "Clear selection, cancel arrow" },
];

/** Map a keydown to an action. Letters use `code` so Alt+I works on every layout (macOS turns it into ˆ). */
export function actionFor(e: KeyboardEvent): ShortcutAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  if (e.key === "?") return "help";
  switch (e.code) {
    case "Space":
      return "playPause";
    case "KeyJ":
      return "shuttleBack";
    case "KeyK":
      return "stop";
    case "KeyL":
      return "shuttleForward";
    case "KeyI":
      return e.altKey ? "clearIn" : "markIn";
    case "KeyO":
      return e.altKey ? "clearOut" : "markOut";
    case "KeyS":
      return "still";
    case "KeyG":
      return "gif";
    case "KeyC":
      return "clip";
    case "ArrowLeft":
      return e.shiftKey ? "stepBackSecond" : "stepBack";
    case "ArrowRight":
      return e.shiftKey ? "stepForwardSecond" : "stepForward";
    case "BracketLeft":
      return "prevCut";
    case "BracketRight":
      return "nextCut";
    case "Enter":
    case "NumpadEnter":
      return "save";
    case "Equal":
    case "NumpadAdd":
      return "zoomIn";
    case "Minus":
    case "NumpadSubtract":
      return "zoomOut";
    case "Home":
      return "home";
    case "End":
      return "end";
  }
  if (e.key === "[") return "prevCut";
  if (e.key === "]") return "nextCut";
  return null;
}

/** Don't steal keys from text fields, sliders, radio groups or open menus. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = target.getAttribute("role");
  return role === "slider" || role === "radio" || role === "menuitem" || role === "option";
}
