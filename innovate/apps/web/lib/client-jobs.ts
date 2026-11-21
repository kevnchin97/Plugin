"use client";

export interface JobDTO {
  id: string;
  status: string;
  error: string | null;
  progress: number;
  downloadUrl: string | null;
  output: { filename: string } | null;
}

/** POST to a job-starting endpoint, poll GET /api/jobs/:id until done, and return the finished job. */
export async function runJob(url: string, onProgress?: (p: number) => void, timeoutMs = 10 * 60_000): Promise<JobDTO> {
  const res = await fetch(url, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't start that. Try again.");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 600));
    const r = await fetch(`/api/jobs/${body.job.id}`);
    if (!r.ok) continue;
    const j = (await r.json()).job as JobDTO;
    onProgress?.(j.progress);
    if (j.status === "failed") throw new Error(j.error ?? "That job failed.");
    if (j.status === "completed") return j;
  }
  throw new Error("This is taking too long. Try again in a minute.");
}

export function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
