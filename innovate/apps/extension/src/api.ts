/** Settings and calls to the Innovate API (token auth). Runs in the service worker and extension pages. */

export interface Settings {
  baseUrl: string;
  token: string;
  boardId: string | null;
}

export interface Board {
  id: string;
  title: string;
}

export interface SavePayload {
  kind: "image" | "video" | "page";
  url: string;
  pageUrl?: string;
  title?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  note?: string;
  boardId?: string | null;
  assumeVideo?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["baseUrl", "token", "boardId"]);
  return { baseUrl: (s.baseUrl as string) || "", token: (s.token as string) || "", boardId: (s.boardId as string) || null };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = await getSettings();
  if (!baseUrl || !token) throw new ApiError("Set your Innovate address and token in the extension options.", 0);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Innovate answered ${res.status}`, res.status);
  return json as T;
}

export const fetchBoards = () => call<{ recent: Board[]; boards: Board[] }>("/api/ext/boards");

export const saveToInnovate = (payload: SavePayload) =>
  call<{ referenceId: string; type: string }>("/api/ext/save", { method: "POST", body: JSON.stringify(payload) });
