import { newId } from './storage';

/**
 * In-process job queue for Phase 1. Same surface as the planned BullMQ queue
 * (enqueue, progress, steps, result), so swapping it out touches only this file.
 * Jobs live in memory: a server restart forgets them.
 */
export type ServerJobType = 'analyze' | 'render';

export interface ServerJob<R = unknown> {
  id: string;
  type: ServerJobType;
  status: 'queued' | 'running' | 'done' | 'failed';
  steps: string[];
  step: number;
  progress: number; // 0–1 within the whole job
  result?: R;
  error?: string;
  createdAt: number;
}

export interface JobContext {
  step: (i: number) => void;
  progress: (p: number) => void;
}

type Runner<R> = (ctx: JobContext) => Promise<R>;

interface Queue {
  jobs: Map<string, ServerJob>;
  waiting: Record<ServerJobType, { job: ServerJob; run: Runner<unknown> }[]>;
  running: Record<ServerJobType, number>;
}

const LIMIT: Record<ServerJobType, number> = { analyze: 2, render: 1 };

const g = globalThis as unknown as { __cutroomQueue?: Queue };
const q: Queue = (g.__cutroomQueue ??= { jobs: new Map(), waiting: { analyze: [], render: [] }, running: { analyze: 0, render: 0 } });

function pump(type: ServerJobType) {
  while (q.running[type] < LIMIT[type] && q.waiting[type].length) {
    const { job, run } = q.waiting[type].shift()!;
    q.running[type]++;
    job.status = 'running';
    const ctx: JobContext = {
      step: (i) => {
        job.step = i;
        job.progress = Math.max(job.progress, i / job.steps.length);
      },
      progress: (p) => {
        const span = 1 / job.steps.length;
        job.progress = Math.min(0.999, job.step * span + Math.max(0, Math.min(1, p)) * span);
      },
    };
    run(ctx)
      .then((result) => {
        job.result = result;
        job.status = 'done';
        job.progress = 1;
        job.step = job.steps.length;
      })
      .catch((err: unknown) => {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        console.error(`[job ${job.id}]`, err);
      })
      .finally(() => {
        q.running[type]--;
        pump(type);
      });
  }
}

export function enqueue<R>(type: ServerJobType, steps: string[], run: Runner<R>): ServerJob<R> {
  const job: ServerJob<R> = { id: newId('job'), type, status: 'queued', steps, step: 0, progress: 0, createdAt: Date.now() };
  q.jobs.set(job.id, job as ServerJob);
  q.waiting[type].push({ job: job as ServerJob, run: run as Runner<unknown> });
  pump(type);
  // Forget finished jobs after an hour.
  for (const [id, j] of q.jobs) if (Date.now() - j.createdAt > 3600_000 && j.status !== 'running') q.jobs.delete(id);
  return job;
}

export const getJob = (id: string) => q.jobs.get(id);
