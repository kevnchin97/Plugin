/**
 * Job queues. Servers use BullMQ on Redis; the desktop app (INNOVATE_DESKTOP=1) runs web and worker
 * in one process and uses the in-process queue below, which implements the part of BullMQ we use:
 * job ids that dedupe, priority (lower first), delay, retries with exponential backoff, progress,
 * waiting for a result, and repeating schedulers. Jobs live in memory, so the desktop server
 * re-queues interrupted work from the database at start-up.
 */
import { EventEmitter } from "node:events";
import { Queue as BullQueue, QueueEvents as BullQueueEvents, Worker as BullWorker, type Job as BullJob } from "bullmq";

export const isDesktop = () => process.env.INNOVATE_DESKTOP === "1";

export interface JobOptions {
  jobId?: string;
  delay?: number;
  priority?: number;
  attempts?: number;
  backoff?: { type: "exponential" | "fixed"; delay: number };
  removeOnComplete?: boolean | { age?: number; count?: number };
  removeOnFail?: boolean | { age?: number; count?: number };
}

/** What a job handler sees (a BullMQ Job satisfies it). */
export interface QueueJob<T = unknown> {
  id?: string;
  name: string;
  data: T;
  attemptsMade: number;
  opts: { attempts?: number };
  updateProgress(progress: number | object): Promise<void>;
}

export type JobState = "waiting" | "delayed" | "active" | "completed" | "failed" | "unknown";

export interface QueueHandle<T> {
  add(name: string, data: T, opts?: JobOptions): Promise<{ id?: string; result(timeoutMs: number): Promise<unknown> }>;
  /** The job's state, or null if there is no such job. */
  state(jobId: string): Promise<JobState | null>;
  retry(jobId: string): Promise<void>;
  remove(jobId: string): Promise<void>;
  /** Repeat a job: `every` ms, or daily at a "m h * * *" cron pattern (UTC). Idempotent per id. */
  schedule(id: string, repeat: { every?: number; pattern?: string }, job: { name: string; data: T; opts?: JobOptions }): Promise<void>;
  close(): Promise<void>;
}

export interface WorkerHandle<T> {
  onFailed(fn: (job: QueueJob<T> | undefined, err: Error) => void | Promise<void>): void;
  onReady(fn: () => void): void;
  close(): Promise<void>;
}

export function redisOptions(url = process.env.REDIS_URL ?? "redis://localhost:6379") {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

// ---------------------------------------------------------------------------------------------
// BullMQ

function bullQueue<T>(name: string, defaults: JobOptions): QueueHandle<T> {
  const q = new BullQueue(name, { connection: redisOptions(), defaultJobOptions: defaults as never });
  let events: BullQueueEvents | undefined;
  return {
    async add(jobName, data, opts) {
      const job = await q.add(jobName as never, data as never, opts as never);
      return {
        id: job.id,
        result: (timeoutMs) => job.waitUntilFinished((events ??= new BullQueueEvents(name, { connection: redisOptions() })), timeoutMs),
      };
    },
    async state(jobId) {
      const job = await q.getJob(jobId);
      return job ? ((await job.getState()) as JobState) : null;
    },
    async retry(jobId) {
      await (await q.getJob(jobId))?.retry();
    },
    async remove(jobId) {
      await q.remove(jobId);
    },
    async schedule(id, repeat, job) {
      await q.upsertJobScheduler(id, repeat.pattern ? { pattern: repeat.pattern, tz: "UTC" } : { every: repeat.every! }, {
        name: job.name,
        data: job.data as never,
        opts: job.opts as never,
      });
    },
    async close() {
      await Promise.all([q.close(), events?.close()]);
    },
  };
}

function bullWorker<T>(name: string, handler: (job: QueueJob<T>) => Promise<unknown>, opts: { concurrency: number; lockDuration?: number }): WorkerHandle<T> {
  const w = new BullWorker(name, (job: BullJob) => handler(job as unknown as QueueJob<T>), { connection: redisOptions(), ...opts });
  return {
    onFailed: (fn) => void w.on("failed", (job, err) => void fn(job as unknown as QueueJob<T> | undefined, err)),
    onReady: (fn) => void w.on("ready", fn),
    close: () => w.close(),
  };
}

// ---------------------------------------------------------------------------------------------
// In-process (desktop)

interface LocalJob<T> extends QueueJob<T> {
  id: string;
  opts: JobOptions;
  state: JobState;
  seq: number;
  readyAt: number;
  progress: number | object;
  returnvalue?: unknown;
  failedReason?: string;
  done: EventEmitter;
}

class LocalQueue<T> {
  readonly jobs = new Map<string, LocalJob<T>>();
  private seq = 0;
  private handler: ((job: QueueJob<T>) => Promise<unknown>) | null = null;
  private concurrency = 1;
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  readonly events = new EventEmitter();
  defaults: JobOptions = {};

  add(name: string, data: T, opts: JobOptions = {}): LocalJob<T> {
    const o = { ...this.defaults, ...opts };
    const id = o.jobId ?? `${name}-${++this.seq}-${Date.now()}`;
    const existing = this.jobs.get(id);
    if (existing) return existing; // BullMQ: adding an existing job id is a no-op
    const job: LocalJob<T> = {
      id,
      name,
      data,
      opts: o,
      attemptsMade: 0,
      state: o.delay ? "delayed" : "waiting",
      seq: ++this.seq,
      readyAt: Date.now() + (o.delay ?? 0),
      progress: 0,
      done: new EventEmitter(),
      updateProgress: async (p) => {
        job.progress = p;
      },
    };
    job.done.on("error", () => {});
    this.jobs.set(id, job);
    this.kick();
    return job;
  }

  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.state !== "failed") return;
    job.state = "waiting";
    job.attemptsMade = 0;
    job.readyAt = Date.now();
    this.kick();
  }

  process(handler: (job: QueueJob<T>) => Promise<unknown>, concurrency: number) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.kick();
  }

  stop() {
    this.handler = null;
    if (this.timer) clearTimeout(this.timer);
    for (const t of this.timers) clearInterval(t);
  }

  repeat(fn: () => void, everyMs: number) {
    const t = setInterval(fn, everyMs);
    t.unref();
    this.timers.add(t);
  }

  repeatDaily(fn: () => void, minute: number, hour: number) {
    const next = () => {
      const now = new Date();
      const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
      return (at > now.getTime() ? at : at + 86_400_000) - now.getTime();
    };
    const arm = () => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        fn();
        arm();
      }, next());
      t.unref();
      this.timers.add(t);
    };
    arm();
  }

  private kick() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    setImmediate(() => this.pump());
  }

  private pump() {
    if (!this.handler) return;
    const now = Date.now();
    while (this.running < this.concurrency) {
      let best: LocalJob<T> | null = null;
      for (const j of this.jobs.values()) {
        if ((j.state !== "waiting" && j.state !== "delayed") || j.readyAt > now) continue;
        const pj = j.opts.priority ?? 0;
        const pb = best?.opts.priority ?? 0;
        if (!best || pj < pb || (pj === pb && j.seq < best.seq)) best = j;
      }
      if (!best) break;
      void this.run(best);
    }
    // Wake up for the next delayed job.
    let soonest = Infinity;
    for (const j of this.jobs.values()) if ((j.state === "waiting" || j.state === "delayed") && j.readyAt > now) soonest = Math.min(soonest, j.readyAt);
    if (soonest !== Infinity && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, soonest - now);
      this.timer.unref();
    }
  }

  private async run(job: LocalJob<T>) {
    this.running++;
    job.state = "active";
    try {
      const out = await this.handler!(job);
      job.attemptsMade++;
      job.state = "completed";
      job.returnvalue = out;
      job.done.emit("completed", out);
      if (job.opts.removeOnComplete === true) this.jobs.delete(job.id);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      job.attemptsMade++;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        const base = job.opts.backoff?.delay ?? 0;
        job.state = "delayed";
        job.readyAt = Date.now() + (job.opts.backoff?.type === "fixed" ? base : base * 2 ** (job.attemptsMade - 1));
      } else {
        job.state = "failed";
        job.failedReason = err.message;
        job.done.emit("failed", err);
      }
      this.events.emit("failed", job, err);
    } finally {
      this.running--;
      this.prune();
      this.kick();
    }
  }

  /** Keep finished jobs (for dedupe and state checks) but not forever. */
  private prune() {
    const finished = [...this.jobs.values()].filter((j) => j.state === "completed" || j.state === "failed");
    for (const j of finished.slice(0, Math.max(0, finished.length - 1000))) this.jobs.delete(j.id);
  }
}

declare global {
  var __innovateLocalQueues: Map<string, LocalQueue<unknown>> | undefined;
}

function local<T>(name: string): LocalQueue<T> {
  const all = (globalThis.__innovateLocalQueues ??= new Map());
  if (!all.has(name)) all.set(name, new LocalQueue());
  return all.get(name) as LocalQueue<T>;
}

function localQueue<T>(name: string, defaults: JobOptions): QueueHandle<T> {
  const q = local<T>(name);
  q.defaults = { ...defaults, ...q.defaults };
  return {
    async add(jobName, data, opts) {
      const job = q.add(jobName, data, opts);
      return {
        id: job.id,
        result: (timeoutMs) =>
          new Promise((resolve, reject) => {
            if (job.state === "completed") return resolve(job.returnvalue);
            if (job.state === "failed") return reject(new Error(job.failedReason));
            const t = setTimeout(() => reject(new Error(`Job ${job.id} timed out`)), timeoutMs);
            job.done.once("completed", (v) => (clearTimeout(t), resolve(v)));
            job.done.once("failed", (e) => (clearTimeout(t), reject(e)));
          }),
      };
    },
    async state(jobId) {
      return q.jobs.get(jobId)?.state ?? null;
    },
    async retry(jobId) {
      q.retry(jobId);
    },
    async remove(jobId) {
      const j = q.jobs.get(jobId);
      if (j && j.state !== "active") q.jobs.delete(jobId);
    },
    async schedule(_id, repeat, job) {
      const fire = () => void q.add(job.name, job.data, job.opts);
      if (repeat.every) q.repeat(fire, repeat.every);
      else if (repeat.pattern) {
        const [m, h] = repeat.pattern.split(/\s+/).map(Number);
        q.repeatDaily(fire, m ?? 0, h ?? 0);
      }
    },
    async close() {},
  };
}

function localWorker<T>(name: string, handler: (job: QueueJob<T>) => Promise<unknown>, opts: { concurrency: number }): WorkerHandle<T> {
  const q = local<T>(name);
  q.process(handler, opts.concurrency);
  return {
    onFailed: (fn) => void q.events.on("failed", (job: QueueJob<T>, err: Error) => void Promise.resolve(fn(job, err)).catch((e) => console.error(e))),
    onReady: (fn) => setImmediate(fn),
    close: async () => q.stop(),
  };
}

// ---------------------------------------------------------------------------------------------

export function openQueue<T>(name: string, defaults: JobOptions = {}): QueueHandle<T> {
  return isDesktop() ? localQueue<T>(name, defaults) : bullQueue<T>(name, defaults);
}

export function startWorker<T>(name: string, handler: (job: QueueJob<T>) => Promise<unknown>, opts: { concurrency: number; lockDuration?: number }): WorkerHandle<T> {
  return isDesktop() ? localWorker<T>(name, handler, opts) : bullWorker<T>(name, handler, opts);
}
