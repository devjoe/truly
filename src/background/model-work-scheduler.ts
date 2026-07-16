import type { ModelWorkPriority } from "../lib/model-work";

export interface ModelWorkRequest<T> {
  id: string;
  resourceKey: string;
  priority: ModelWorkPriority;
  dedupeKey?: string;
  /** Pending work with the same key is obsolete when a newer request arrives. */
  supersedeKey?: string;
  run(): Promise<T>;
}

interface PendingJob<T = unknown> extends ModelWorkRequest<T> {
  sequence: number;
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface ResourceState {
  running: boolean;
  queue: PendingJob[];
  foregroundBurst: number;
}

export class ModelWorkSupersededError extends Error {
  constructor() {
    super("model_work_superseded");
    this.name = "ModelWorkSupersededError";
  }
}

const PRIORITY_ORDER: Record<ModelWorkPriority, number> = {
  user_blocking: 0,
  foreground: 1,
  derived: 2,
  prefetch: 3,
};

/**
 * Volatile service-worker scheduler. It never persists model inputs or jobs.
 * Every model resource runs one request at a time; separate resources may run
 * independently. Callers own semantic validation and stale-result rejection.
 */
export class ModelWorkScheduler {
  private readonly resources = new Map<string, ResourceState>();
  private readonly deduped = new Map<string, Promise<unknown>>();
  private sequence = 0;
  private readonly foregroundBurstLimit: number;

  constructor(options: { foregroundBurstLimit?: number } = {}) {
    this.foregroundBurstLimit = Math.max(1, options.foregroundBurstLimit ?? 3);
  }

  enqueue<T>(request: ModelWorkRequest<T>): Promise<T> {
    const dedupeMapKey = request.dedupeKey
      ? `${request.resourceKey}\u0000${request.dedupeKey}`
      : undefined;
    const existing = dedupeMapKey ? this.deduped.get(dedupeMapKey) : undefined;
    if (existing) return existing as Promise<T>;

    const state = this.stateFor(request.resourceKey);
    if (request.supersedeKey) {
      for (let index = state.queue.length - 1; index >= 0; index -= 1) {
        const pending = state.queue[index];
        if (pending.supersedeKey !== request.supersedeKey) continue;
        state.queue.splice(index, 1);
        this.clearDedupe(pending);
        pending.reject(new ModelWorkSupersededError());
      }
    }

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const job: PendingJob<T> = {
      ...request,
      sequence: this.sequence++,
      promise,
      resolve,
      reject,
    };
    state.queue.push(job as PendingJob);
    if (dedupeMapKey) this.deduped.set(dedupeMapKey, promise);
    queueMicrotask(() => this.drain(request.resourceKey));
    return promise;
  }

  private stateFor(resourceKey: string): ResourceState {
    const existing = this.resources.get(resourceKey);
    if (existing) return existing;
    const created: ResourceState = { running: false, queue: [], foregroundBurst: 0 };
    this.resources.set(resourceKey, created);
    return created;
  }

  private drain(resourceKey: string): void {
    const state = this.resources.get(resourceKey);
    if (!state || state.running || state.queue.length === 0) return;
    const index = this.pickIndex(state);
    const job = state.queue.splice(index, 1)[0];
    if (!job) return;
    state.running = true;
    const countsTowardForegroundBurst = job.priority === "foreground" &&
      state.queue.some((candidate) => candidate.priority === "derived");

    void job.run().then(job.resolve, job.reject).finally(() => {
      this.clearDedupe(job);
      if (job.priority === "derived") state.foregroundBurst = 0;
      else if (countsTowardForegroundBurst) state.foregroundBurst += 1;
      else if (!state.queue.some((candidate) => candidate.priority === "derived")) state.foregroundBurst = 0;
      state.running = false;
      if (state.queue.length === 0) {
        this.resources.delete(resourceKey);
        return;
      }
      queueMicrotask(() => this.drain(resourceKey));
    });
  }

  private pickIndex(state: ResourceState): number {
    const first = (priority: ModelWorkPriority) => state.queue
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.priority === priority)
      .sort((a, b) => a.job.sequence - b.job.sequence)[0]?.index;
    const blocking = first("user_blocking");
    if (blocking !== undefined) return blocking;
    const derived = first("derived");
    if (derived !== undefined && state.foregroundBurst >= this.foregroundBurstLimit) return derived;
    const foreground = first("foreground");
    if (foreground !== undefined) return foreground;
    if (derived !== undefined) return derived;
    return state.queue
      .map((job, index) => ({ job, index }))
      .sort((a, b) => PRIORITY_ORDER[a.job.priority] - PRIORITY_ORDER[b.job.priority] || a.job.sequence - b.job.sequence)[0]?.index ?? 0;
  }

  private clearDedupe(job: PendingJob): void {
    const key = job.dedupeKey ? `${job.resourceKey}\u0000${job.dedupeKey}` : undefined;
    if (key && this.deduped.get(key) === job.promise) {
      this.deduped.delete(key);
    }
  }
}
