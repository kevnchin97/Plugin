import { type Board, fetchBoards, getSettings, setSettings } from "./api";
import type { Capture } from "./capture";
import "./ui.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  // ?tab=<id> lets the popup be opened as a page (tests); normally it's the active tab.
  const fromQuery = Number(new URLSearchParams(location.search).get("tab"));
  if (fromQuery) return chrome.tabs.get(fromQuery);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function option(b: Board) {
  const o = document.createElement("option");
  o.value = b.id;
  o.textContent = b.title;
  return o;
}

async function main() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.token) {
    $("setup").hidden = false;
    $("main").hidden = true;
    $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }
  const select = $<HTMLSelectElement>("board");
  const status = $("status");
  try {
    const { recent, boards } = await fetchBoards();
    select.append(option({ id: "", title: "Unsorted" }));
    if (recent.length) {
      const g = document.createElement("optgroup");
      g.label = "Recent";
      recent.forEach((b) => g.append(option(b)));
      select.append(g);
    }
    if (boards.length) {
      const g = document.createElement("optgroup");
      g.label = "All boards";
      boards.forEach((b) => g.append(option(b)));
      select.append(g);
    }
    select.value = settings.boardId ?? "";
  } catch (err) {
    status.textContent = (err as Error).message;
    status.className = "status error";
  }
  select.addEventListener("change", () => void setSettings({ boardId: select.value || null }));

  const tab = await targetTab();
  const capture = (tab?.id ? await chrome.runtime.sendMessage({ type: "capture", tabId: tab.id }) : null) as Capture | null;
  const what = capture ?? (tab?.url ? ({ kind: "page", url: tab.url, pageUrl: tab.url, title: tab.title ?? tab.url, site: "generic" } as Capture) : null);
  if (what) {
    $("title").textContent = what.title;
    $("kind").textContent = what.kind === "page" ? "Page" : what.kind === "video" ? "Video" : "Image";
    $("site").textContent = what.site === "generic" ? new URL(what.pageUrl).hostname : what.site;
    const preview = what.kind === "image" ? what.url : what.imageUrl;
    if (preview) {
      const img = $<HTMLImageElement>("preview");
      img.src = preview;
      img.hidden = false;
    }
  }
  const button = $<HTMLButtonElement>("save");
  button.disabled = !what;
  button.addEventListener("click", async () => {
    if (!what) return;
    button.disabled = true;
    status.textContent = "Saving…";
    status.className = "status";
    const r = (await chrome.runtime.sendMessage({
      type: "save",
      payload: { kind: what.kind, url: what.url, pageUrl: what.pageUrl, title: what.title, imageUrl: what.imageUrl, note: what.note, assumeVideo: what.assumeVideo, boardId: select.value || null },
    })) as { ok: boolean; message: string };
    status.textContent = r.ok ? `${r.message} to ${select.selectedOptions[0]?.textContent ?? "Unsorted"}` : r.message;
    status.className = r.ok ? "status ok" : "status error";
    button.disabled = false;
  });
}

void main();
