// IntersectionObserver-based dwell detector. Fires once per element
// after `dwellMs` of continuous visibility (≥ 50% intersection ratio).
// Used by the two-tier classifier to send a Tier B (deep) request only
// for posts the user actually reads, not posts they scrolled past.
//
// Idempotent per element via a fired Set — re-entering the viewport
// after firing does NOT re-trigger. Callers mark elements as fired
// implicitly the first time the callback runs.

export type DwellCallback = (el: HTMLElement) => void;

interface DwellTimer {
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

export interface DwellDetectorOptions {
  dwellMs: number;
  /** Min intersection ratio to count as "visible enough." 0.5 means
   *  half the post is in viewport. 0.3 is more permissive. */
  threshold?: number;
}

export class DwellDetector {
  private observer: IntersectionObserver;
  private fired = new Set<HTMLElement>();
  private active = new Map<HTMLElement, DwellTimer>();
  private observed = new Set<HTMLElement>();
  private dwellMs: number;
  private threshold: number;

  constructor(
    callback: DwellCallback,
    opts: DwellDetectorOptions,
  ) {
    this.dwellMs = opts.dwellMs;
    this.threshold = opts.threshold ?? 0.5;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (this.fired.has(el)) continue;
          if (entry.intersectionRatio >= this.threshold) {
            // Already armed? Skip — IO can fire multiple entries per
            // element while ratios oscillate; keep the first timer.
            if (this.active.has(el)) continue;
            const timer = setTimeout(() => {
              this.active.delete(el);
              this.fired.add(el);
              callback(el);
            }, this.dwellMs);
            this.active.set(el, { el, timer });
          } else {
            // Visibility dropped below threshold mid-dwell — cancel.
            const t = this.active.get(el);
            if (t) {
              clearTimeout(t.timer);
              this.active.delete(el);
            }
          }
        }
      },
      { threshold: [0, this.threshold, 1] },
    );
  }

  /** Start watching an element. Safe to call multiple times for the
   *  same element — idempotent. */
  observe(el: HTMLElement): void {
    if (this.fired.has(el)) return;
    this.observed.add(el);
    this.observer.observe(el);
  }

  /** Stop watching an element. Used when the post is removed from
   *  the DOM (FB virtual scroll). */
  unobserve(el: HTMLElement): void {
    const t = this.active.get(el);
    if (t) {
      clearTimeout(t.timer);
      this.active.delete(el);
    }
    this.observed.delete(el);
    this.observer.unobserve(el);
  }

  /** Update dwell timing for future timers. Active timers are re-armed so a
   *  settings change takes effect without reloading the Facebook tab. */
  updateDwellMs(dwellMs: number): void {
    if (!Number.isFinite(dwellMs) || dwellMs <= 0 || dwellMs === this.dwellMs) return;
    this.dwellMs = dwellMs;
    for (const { timer } of this.active.values()) clearTimeout(timer);
    this.active.clear();
    for (const el of this.observed) {
      if (this.fired.has(el)) continue;
      this.observer.unobserve(el);
      this.observer.observe(el);
    }
  }

  /** For tests: reset internal state. */
  __reset(): void {
    for (const { timer } of this.active.values()) clearTimeout(timer);
    this.active.clear();
    this.fired.clear();
  }

  destroy(): void {
    for (const { timer } of this.active.values()) clearTimeout(timer);
    this.active.clear();
    this.observed.clear();
    this.observer.disconnect();
  }
}
