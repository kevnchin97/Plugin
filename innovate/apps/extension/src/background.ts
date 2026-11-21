/**
 * Service worker: right-click "Save to Innovate" for images, videos, links and pages, and the
 * save path the popup uses. Feedback shows on the toolbar badge (✓ / !) and in the popup.
 */
import { ApiError, getSettings, type SavePayload, saveToInnovate } from "./api";
import { capturePage, resolveImage } from "./capture";

type Context = `${chrome.contextMenus.ContextType}`;
const MENUS: { id: string; title: string; context: Context }[] = [
  { id: "save-image", title: "Save image to Innovate", context: "image" },
  { id: "save-video", title: "Save video to Innovate", context: "video" },
  { id: "save-link", title: "Save link to Innovate", context: "link" },
  { id: "save-page", title: "Save page to Innovate", context: "page" },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) chrome.contextMenus.create({ id: m.id, title: m.title, contexts: [m.context as chrome.contextMenus.ContextType] });
  });
});

async function inTab<T>(tabId: number, func: (...args: never[]) => T, args: unknown[] = []): Promise<T | null> {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: func as () => T, args: args as [] });
    return (r?.result as T) ?? null;
  } catch {
    return null; // chrome:// pages, the web store, etc.
  }
}

async function flash(ok: boolean, tabId?: number) {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e7a4f" : "#b3261e" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!", tabId });
  setTimeout(() => void chrome.action.setBadgeText({ text: "", tabId }), 2500);
}

export interface SaveResult {
  ok: boolean;
  message: string;
  referenceId?: string;
  savedAs?: string;
}

/** Save, falling back to saving the page when a video can't be imported as a file. */
export async function save(payload: SavePayload): Promise<SaveResult> {
  const { boardId } = await getSettings();
  const body = { ...payload, boardId: payload.boardId === undefined ? boardId : payload.boardId };
  try {
    const r = await saveToInnovate(body);
    return { ok: true, message: `Saved ${r.type === "link" ? "page" : r.type}`, referenceId: r.referenceId, savedAs: r.type };
  } catch (err) {
    if (err instanceof ApiError && err.status === 422 && payload.kind === "video" && payload.pageUrl) {
      const r = await saveToInnovate({ kind: "page", url: payload.pageUrl, title: payload.title, imageUrl: payload.imageUrl, boardId: body.boardId });
      return { ok: true, message: `Saved the page (${err.message.replace(/\.$/, "")})`, referenceId: r.referenceId, savedAs: "link" };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const tabId = tab?.id;
  const pageUrl = info.pageUrl ?? tab?.url;
  const title = tab?.title;
  let payload: SavePayload;
  if (info.menuItemId === "save-image" && info.srcUrl) {
    const best = tabId ? await inTab(tabId, resolveImage, [info.srcUrl]) : null;
    payload = { kind: "image", url: best?.url ?? info.srcUrl, width: best?.width, height: best?.height, pageUrl, title };
  } else if (info.menuItemId === "save-video" && info.srcUrl) {
    payload = { kind: "video", url: info.srcUrl, pageUrl, title };
  } else if (info.menuItemId === "save-link" && info.linkUrl) {
    payload = { kind: /\.(mp4|mov|webm)(\?|$)/i.test(info.linkUrl) ? "video" : "page", url: info.linkUrl, pageUrl, title: info.selectionText };
  } else {
    const c = tabId ? await inTab(tabId, capturePage) : null;
    payload = c ? { ...c } : { kind: "page", url: pageUrl ?? "", pageUrl, title };
  }
  const result = await save(payload);
  await chrome.storage.local.set({ lastResult: { ...result, at: Date.now() } });
  await flash(result.ok, tabId);
}

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenu(info, tab));

chrome.runtime.onMessage.addListener((msg: { type: string; payload?: SavePayload; tabId?: number; srcUrl?: string }, _sender, reply) => {
  if (msg.type === "save" && msg.payload) {
    void save(msg.payload).then(async (r) => {
      await chrome.storage.local.set({ lastResult: { ...r, at: Date.now() } });
      reply(r);
    });
    return true;
  }
  if (msg.type === "capture" && msg.tabId) {
    void inTab(msg.tabId, capturePage).then(reply);
    return true;
  }
  if (msg.type === "resolve-image" && msg.tabId && msg.srcUrl) {
    void inTab(msg.tabId, resolveImage, [msg.srcUrl]).then(reply);
    return true;
  }
  return false;
});
