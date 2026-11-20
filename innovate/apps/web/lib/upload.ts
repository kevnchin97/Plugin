"use client";
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from "@innovate/shared";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function putFile(url: string, file: File, type: string, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

function videoType(file: File): string | null {
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "mp4" || ext === "m4v" ? "video/mp4" : null;
}

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => reject(new Error(`${file.name} isn't an image we can read.`));
    img.src = url;
  });
}

/** Upload images (ready immediately) and videos (queued for ingest). Returns the new reference ids. */
export async function uploadFiles(files: File[], onError: (msg: string) => void, boardId?: string): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    try {
      if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
        const { width, height } = await imageSize(file);
        const { id, uploadUrl } = await post<{ id: string; uploadUrl: string }>("/api/images", {
          filename: file.name,
          contentType: file.type,
          size: file.size,
          width,
          height,
          boardId: boardId ?? null,
        });
        await putFile(uploadUrl, file, file.type);
        await post(`/api/references/${id}/ingest`);
        ids.push(id);
      } else {
        const type = videoType(file);
        if (!type) throw new Error(`${file.name}: drop images (JPG, PNG, WebP, GIF) or videos (MP4, MOV, WebM).`);
        const { id, uploadUrl } = await post<{ id: string; uploadUrl: string }>("/api/references", { kind: "upload", filename: file.name, contentType: type, size: file.size });
        await putFile(uploadUrl, file, type);
        await post(`/api/references/${id}/ingest`);
        ids.push(id);
      }
    } catch (err) {
      onError((err as Error).message);
    }
  }
  return ids;
}
