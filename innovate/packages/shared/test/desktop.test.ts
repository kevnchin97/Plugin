import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openQueue, startWorker, type WorkerHandle } from "../src/server/queue";
import { LocalStorage } from "../src/server/storage";

/** The desktop app's stand-ins for S3 and BullMQ (INNOVATE_DESKTOP=1). */

describe("LocalStorage", () => {
  const dir = mkdtempSync(join(tmpdir(), "innovate-storage-"));
  const s = new LocalStorage({ dir, secret: "test-secret-test-secret", publicUrl: "http://127.0.0.1:47800", signedUrlTtl: 60 });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("maps keys to files, encoding characters Windows can't store", () => {
    expect(s.pathFor("ws/a/ref/b/exports/agent-export:b:gif:0-24.gif")).toBe(join(dir, "ws/a/ref/b/exports/agent-export%3ab%3agif%3a0-24.gif"));
    expect(s.pathFor("a/100%.png")).toBe(join(dir, "a/100%25.png"));
    for (const bad of ["", "../x", "a/../../x", "a//b", "a/./b"]) expect(() => s.pathFor(bad), bad).toThrow(/Bad storage key/);
  });

  it("stores, reads back and heads files", async () => {
    const src = join(dir, "src.txt");
    writeFileSync(src, "hello");
    expect(await s.uploadFile("ws/1/a:b.txt", src, "text/plain")).toBe(5);
    expect(await s.head("ws/1/a:b.txt")).toEqual({ size: 5, contentType: "application/octet-stream" });
    expect(await s.head("ws/1/missing.txt")).toBeNull();
    const out = join(dir, "out.txt");
    await s.downloadFile("ws/1/a:b.txt", out);
    expect(readFileSync(out, "utf8")).toBe("hello");
  });

  it("signs URLs per method and key, and they expire", async () => {
    const url = new URL(await s.signedGetUrl("ws/1/clip.mp4", { downloadName: "Clip.mp4" }));
    expect(url.pathname).toBe("/api/files/ws/1/clip.mp4");
    expect(s.verify("GET", "ws/1/clip.mp4", url.searchParams)).toBe(true);
    expect(s.verify("PUT", "ws/1/clip.mp4", url.searchParams)).toBe(false);
    expect(s.verify("GET", "ws/1/other.mp4", url.searchParams)).toBe(false);
    const tampered = new URLSearchParams(url.searchParams);
    tampered.set("dl", "Other.mp4");
    expect(s.verify("GET", "ws/1/clip.mp4", tampered)).toBe(false);
    const expired = new URL(await s.signedGetUrl("ws/1/clip.mp4", { expiresIn: -1 }));
    expect(s.verify("GET", "ws/1/clip.mp4", expired.searchParams)).toBe(false);
  });
});

describe("in-process queue", () => {
  const workers: WorkerHandle<unknown>[] = [];
  beforeAll(() => void (process.env.INNOVATE_DESKTOP = "1"));
  afterEach(async () => {
    for (const w of workers.splice(0)) await w.close();
  });
  let n = 0;
  const name = () => `test-${++n}`;

  it("runs by priority, dedupes job ids, and returns results", async () => {
    const q = openQueue<{ v: string }>(name());
    const order: string[] = [];
    await q.add("x", { v: "low" }, { priority: 20 });
    await q.add("x", { v: "high" }, { priority: 1, jobId: "same" });
    await q.add("x", { v: "duplicate" }, { jobId: "same" });
    const job = await q.add("x", { v: "mid" }, { priority: 10 });
    workers.push(startWorker<{ v: string }>(`test-${n}`, async (j) => (order.push(j.data.v), j.data.v.toUpperCase()), { concurrency: 1 }));
    expect(await job.result(2000)).toBe("MID");
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["high", "mid", "low"]);
    expect(await q.state("same")).toBe("completed");
  });

  it("retries with backoff, then fails with the last error", async () => {
    const queueName = name();
    const q = openQueue<null>(queueName, { attempts: 3, backoff: { type: "fixed", delay: 5 } });
    let calls = 0;
    const failed: number[] = [];
    const w = startWorker<null>(queueName, async () => {
      calls++;
      throw new Error(`boom ${calls}`);
    }, { concurrency: 1 });
    w.onFailed((job) => void failed.push(job!.attemptsMade));
    workers.push(w);
    const job = await q.add("x", null, { jobId: "j" });
    await expect(job.result(2000)).rejects.toThrow("boom 3");
    expect(calls).toBe(3);
    expect(failed).toEqual([1, 2, 3]);
    expect(await q.state("j")).toBe("failed");
    // retry() runs a failed job again
    await q.retry("j");
    await expect(q.add("x", null, { jobId: "j" }).then((j) => j.result(2000))).rejects.toThrow("boom 6");
  });

  it("waits for delayed jobs and reports progress to the handler's job", async () => {
    const queueName = name();
    const q = openQueue<number>(queueName);
    workers.push(startWorker<number>(queueName, async (j) => (await j.updateProgress({ at: j.data }), j.data * 2), { concurrency: 2 }));
    const started = Date.now();
    const job = await q.add("x", 21, { delay: 50 });
    expect(await job.result(2000)).toBe(42);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});
