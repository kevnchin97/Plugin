import type { Job } from "bullmq";
import { eq, mediaJobs, references } from "@innovate/db";
import type { JobStage } from "@innovate/shared";
import { db } from "./context";

/**
 * Reports progress to both BullMQ and the media_jobs row the UI polls.
 * DB writes are throttled; stage changes are written immediately.
 */
export class Progress {
  private lastWrite = 0;
  private stage: JobStage = "queued";
  private value = 0;

  constructor(
    private readonly job: Job,
    private readonly jobId: string,
    private readonly referenceId?: string,
  ) {}

  async setStage(stage: JobStage, value?: number) {
    this.stage = stage;
    if (value !== undefined) this.value = value;
    await this.write(true);
  }

  /** Map a sub-task's 0..1 progress into [from, to] of the whole job. */
  span(from: number, to: number) {
    return (f: number) => {
      this.value = from + (to - from) * f;
      void this.write(false);
    };
  }

  private async write(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastWrite < 250) return;
    this.lastWrite = now;
    const progress = Math.round(this.value * 1000) / 10;
    await Promise.all([
      this.job.updateProgress({ stage: this.stage, progress }).catch(() => {}),
      db.update(mediaJobs).set({ stage: this.stage, progress, status: "active" }).where(eq(mediaJobs.id, this.jobId)),
      this.referenceId && isIngestStage(this.stage)
        ? db.update(references).set({ stage: this.stage }).where(eq(references.id, this.referenceId))
        : null,
    ]);
  }
}

function isIngestStage(stage: JobStage) {
  return ["fetching", "probing", "proxy", "filmstrip", "scenes"].includes(stage);
}
