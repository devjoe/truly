import { describe, expect, it } from "vitest";
import {
  ModelWorkScheduler,
  ModelWorkSupersededError,
} from "../../src/background/model-work-scheduler";
import {
  modelWorkPriorityForDeepSource,
  modelWorkPriorityForReadingBriefSource,
} from "../../src/lib/model-work";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("model work scheduler", () => {
  it("maps user, foreground, derived, and prefetch sources consistently", () => {
    expect(modelWorkPriorityForDeepSource("expand")).toBe("user_blocking");
    expect(modelWorkPriorityForDeepSource("manual")).toBe("user_blocking");
    expect(modelWorkPriorityForDeepSource("auto")).toBe("foreground");
    expect(modelWorkPriorityForDeepSource("prefetch")).toBe("prefetch");
    expect(modelWorkPriorityForReadingBriefSource("user")).toBe("user_blocking");
    expect(modelWorkPriorityForReadingBriefSource("prefetch")).toBe("derived");
    expect(modelWorkPriorityForReadingBriefSource(undefined)).toBe("user_blocking");
  });

  it("scopes deduplication to one model resource", async () => {
    const scheduler = new ModelWorkScheduler();
    const first = scheduler.enqueue({
      id: "first",
      resourceKey: "endpoint-a:model",
      priority: "foreground",
      dedupeKey: "same-semantic-work",
      run: async () => "a",
    });
    const second = scheduler.enqueue({
      id: "second",
      resourceKey: "endpoint-b:model",
      priority: "foreground",
      dedupeKey: "same-semantic-work",
      run: async () => "b",
    });

    expect(second).not.toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
  });

  it("serializes one endpoint and runs foreground work before queued prefetch", async () => {
    const scheduler = new ModelWorkScheduler();
    const blocker = deferred<string>();
    const order: string[] = [];
    const running = scheduler.enqueue({
      id: "running",
      resourceKey: "endpoint:model",
      priority: "foreground",
      run: async () => {
        order.push("running");
        return blocker.promise;
      },
    });
    const prefetch = scheduler.enqueue({
      id: "prefetch",
      resourceKey: "endpoint:model",
      priority: "prefetch",
      run: async () => { order.push("prefetch"); return "prefetch"; },
    });
    const foreground = scheduler.enqueue({
      id: "foreground",
      resourceKey: "endpoint:model",
      priority: "foreground",
      run: async () => { order.push("foreground"); return "foreground"; },
    });

    await Promise.resolve();
    expect(order).toEqual(["running"]);
    blocker.resolve("running");
    await Promise.all([running, prefetch, foreground]);
    expect(order).toEqual(["running", "foreground", "prefetch"]);
  });

  it("deduplicates identical work and supersedes stale pending derived work", async () => {
    const scheduler = new ModelWorkScheduler();
    const blocker = deferred<string>();
    let calls = 0;
    const running = scheduler.enqueue({
      id: "running",
      resourceKey: "endpoint:model",
      priority: "foreground",
      run: () => blocker.promise,
    });
    const first = scheduler.enqueue({
      id: "adapter-old",
      resourceKey: "endpoint:model",
      priority: "derived",
      dedupeKey: "adapter:old",
      supersedeKey: "page:1:page",
      run: async () => { calls += 1; return "old"; },
    });
    const duplicate = scheduler.enqueue({
      id: "adapter-old-duplicate",
      resourceKey: "endpoint:model",
      priority: "derived",
      dedupeKey: "adapter:old",
      supersedeKey: "page:1:page",
      run: async () => { calls += 1; return "duplicate"; },
    });
    expect(duplicate).toBe(first);

    const latest = scheduler.enqueue({
      id: "adapter-new",
      resourceKey: "endpoint:model",
      priority: "derived",
      dedupeKey: "adapter:new",
      supersedeKey: "page:1:page",
      run: async () => { calls += 1; return "new"; },
    });
    await expect(first).rejects.toBeInstanceOf(ModelWorkSupersededError);
    blocker.resolve("running");
    await running;
    await expect(latest).resolves.toBe("new");
    expect(calls).toBe(1);
  });

  it("lets one derived job run after a bounded foreground burst", async () => {
    const scheduler = new ModelWorkScheduler({ foregroundBurstLimit: 2 });
    const blocker = deferred<string>();
    const order: string[] = [];
    const running = scheduler.enqueue({
      id: "running",
      resourceKey: "endpoint:model",
      priority: "foreground",
      run: () => blocker.promise,
    });
    const jobs = [1, 2, 3].map((index) => scheduler.enqueue({
      id: `foreground-${index}`,
      resourceKey: "endpoint:model",
      priority: "foreground" as const,
      run: async () => { order.push(`foreground-${index}`); return index; },
    }));
    const derived = scheduler.enqueue({
      id: "derived",
      resourceKey: "endpoint:model",
      priority: "derived",
      run: async () => { order.push("derived"); return "derived"; },
    });
    blocker.resolve("running");
    await Promise.all([running, ...jobs, derived]);
    // The already-running foreground request counts toward the bounded burst
    // once derived work is waiting, so only one additional foreground job may
    // pass before the adapter gets a turn.
    expect(order).toEqual(["foreground-1", "derived", "foreground-2", "foreground-3"]);
  });
});
