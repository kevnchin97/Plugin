"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES, VIDEO_MIME_TYPES } from "@innovate/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";

type Phase = { kind: "idle" } | { kind: "uploading"; name: string; progress: number } | { kind: "starting" } | { kind: "error"; message: string };

const ACCEPT = ".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/webm";

function mimeFor(file: File): string | null {
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return null;
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function put(url: string, file: File, type: string, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

export function Intake() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase.kind === "uploading" || phase.kind === "starting";

  const uploadFile = useCallback(
    async (file: File) => {
      const type = mimeFor(file);
      if (!type) return setPhase({ kind: "error", message: "That isn't a video we can use. Drop an MP4, MOV or WebM file." });
      if (file.size > MAX_UPLOAD_BYTES) return setPhase({ kind: "error", message: "That file is over the 4 GB upload limit." });
      try {
        setPhase({ kind: "uploading", name: file.name, progress: 0 });
        const { id, uploadUrl } = await api<{ id: string; uploadUrl: string }>("/api/references", {
          kind: "upload",
          filename: file.name,
          contentType: type,
          size: file.size,
        });
        await put(uploadUrl, file, type, (progress) => setPhase({ kind: "uploading", name: file.name, progress }));
        setPhase({ kind: "starting" });
        await api(`/api/references/${id}/ingest`);
        router.push(`/make/${id}`);
      } catch (err) {
        setPhase({ kind: "error", message: (err as Error).message });
      }
    },
    [router],
  );

  const submitUrl = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      try {
        setPhase({ kind: "starting" });
        const { id } = await api<{ id: string }>("/api/references", { kind: "url", url: trimmed });
        router.push(`/make/${id}`);
      } catch (err) {
        setPhase({ kind: "error", message: (err as Error).message });
      }
    },
    [router],
  );

  // Paste a link or a file anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy) return;
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        void uploadFile(file);
        return;
      }
      const text = e.clipboardData?.getData("text")?.trim();
      if (text && /^https?:\/\//i.test(text) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setUrl(text);
        void submitUrl(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, submitUrl, uploadFile]);

  return (
    <div className="mx-auto flex h-full max-w-[880px] flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">GIF Maker</h1>
      <p className="mt-1 max-w-[560px] text-md text-text-muted">
        Bring in a video, find the moment, and pull a frame-accurate still, GIF or clip. Scenes are detected for you.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) void uploadFile(file);
        }}
        className={`mt-8 grid min-h-[300px] place-items-center rounded-lg border border-dashed transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface"
        }`}
      >
        {phase.kind === "uploading" ? (
          <div className="w-[min(420px,80%)] text-center" role="status">
            <p className="truncate text-md">{phase.name}</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-4">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-text-muted tabular">Uploading {Math.round(phase.progress * 100)}%</p>
          </div>
        ) : phase.kind === "starting" ? (
          <p className="text-md text-text-muted" role="status">
            Starting…
          </p>
        ) : (
          <div className="flex flex-col items-center text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" className="text-text-faint" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <p className="mt-4 text-lg">Drop a video here</p>
            <p className="mt-1 text-sm text-text-faint">MP4, MOV or WebM · up to 4 GB</p>
            <Button className="mt-5" variant="primary" onClick={() => fileInput.current?.click()}>
              Choose a file
            </Button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          data-testid="file-input"
          aria-label="Choose a video file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitUrl(url);
        }}
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="…or paste a direct video link (https://…/clip.mp4)"
          aria-label="Video link"
          className="h-9 flex-1 rounded-md border border-border-strong bg-surface-2 px-3 text-md placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          Import link
        </Button>
      </form>
      <p className="mt-2 text-xs text-text-faint">
        Tip: paste anywhere with <Kbd>⌘</Kbd> <Kbd>V</Kbd>. Instagram, YouTube and Vimeo links need ingest adapters, which arrive in a later
        release.
      </p>

      {phase.kind === "error" && (
        <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {phase.message}
        </p>
      )}
    </div>
  );
}
