import type { TrulyMessage } from "../lib/messages";
import { resolveLanguage } from "../lib/i18n";
import { isSharedModelLane } from "../lib/settings";
import type { DashboardPostEvent, UserSettings } from "../lib/types";
import {
  resolveReadingBriefRequestGate,
  type ReadingBriefRequestGate,
} from "./reading-brief-gate";

const READING_BRIEF_FOCUS_DELAY_MS = 800;
const READING_BRIEF_SHARED_FOCUS_DELAY_MS = 2200;
const READING_BRIEF_RETRY_DELAY_MS = 1200;
const READING_BRIEF_SHARED_RETRY_DELAY_MS = 3000;
const READING_BRIEF_SHARED_COOLDOWN_MS = 1800;

type TimerId = number;

export interface ReadingBriefControllerDeps {
  settings(): UserSettings;
  tierAEndpoint(): string | undefined;
  tierAModel(): string | undefined;
  currentPostId(): string | null;
  latestEventFor(postId: string): DashboardPostEvent | undefined;
  patchLatestEvent(postId: string, patch: Partial<DashboardPostEvent>): void;
  rerender(postId: string): void;
  sendMessage(message: TrulyMessage, callback: (response: TrulyMessage | undefined) => void): void;
  lastErrorMessage(): string | undefined;
  now(): number;
  setTimer(callback: () => void, delayMs: number): TimerId;
  clearTimer(timerId: TimerId): void;
}

export interface ReadingBriefControllerOptions {
  deps: ReadingBriefControllerDeps;
}

export class ReadingBriefController {
  private readonly deps: ReadingBriefControllerDeps;
  private readonly inflight = new Set<string>();
  private timer: TimerId | undefined;
  private lastRequestAt = 0;

  constructor(options: ReadingBriefControllerOptions) {
    this.deps = options.deps;
  }

  isInflight(postId: string): boolean {
    return this.inflight.has(postId);
  }

  requestGate(event: DashboardPostEvent): ReadingBriefRequestGate {
    return resolveReadingBriefRequestGate({
      event,
      settings: this.deps.settings(),
      environment: {
        tierAEndpoint: this.deps.tierAEndpoint(),
        tierAModel: this.deps.tierAModel(),
      },
      inflight: this.isInflight(event.id),
    });
  }

  canRequest(event: DashboardPostEvent): boolean {
    return this.requestGate(event).canRequest;
  }

  scheduleCurrent(delayMs = this.focusDelayMs()): void {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = undefined;
      const id = this.deps.currentPostId();
      if (!id) return;
      const latest = this.deps.latestEventFor(id);
      if (!latest || !this.canRequest(latest)) return;
      if (this.shouldSerialize() && this.inflight.size > 0) {
        this.scheduleCurrent(this.retryDelayMs());
        return;
      }
      if (this.shouldSerialize()) {
        const elapsed = this.deps.now() - this.lastRequestAt;
        if (elapsed < READING_BRIEF_SHARED_COOLDOWN_MS) {
          this.scheduleCurrent(READING_BRIEF_SHARED_COOLDOWN_MS - elapsed);
          return;
        }
      }
      this.maybeTrigger(latest);
    }, delayMs);
  }

  maybeTrigger(event: DashboardPostEvent): void {
    const requestGate = this.requestGate(event);
    if (!requestGate.canRequest) return;
    const gate = requestGate.featureGate;

    this.inflight.add(event.id);
    this.lastRequestAt = this.deps.now();
    this.deps.patchLatestEvent(event.id, { readingBriefPending: true });
    queueMicrotask(() => this.deps.rerender(event.id));

    const msg: TrulyMessage = {
      type: "READING_BRIEF_REQUEST",
      postId: event.id,
      endpoint: gate.endpoint,
      model: gate.model,
      provider: gate.effectiveProvider,
      outputLang: resolveLanguage(this.deps.settings().language),
      event,
    };
    this.deps.sendMessage(msg, (response: TrulyMessage | undefined) => {
      this.inflight.delete(event.id);
      const latest = this.deps.latestEventFor(event.id);
      if (response && response.type === "READING_BRIEF_RESULT" && latest) {
        if (response.ok) {
          this.deps.patchLatestEvent(event.id, {
            readingBrief: response.brief,
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: undefined,
          });
        } else {
          this.deps.patchLatestEvent(event.id, {
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: response.error || "reading_brief_failed",
          });
        }
      } else {
        const error = this.deps.lastErrorMessage();
        if (error && latest) {
          this.deps.patchLatestEvent(event.id, {
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: error || "runtime_error",
          });
        }
      }
      this.deps.rerender(event.id);
      const currentId = this.deps.currentPostId();
      if (currentId && currentId !== event.id) this.scheduleCurrent(this.retryDelayMs());
    });
  }

  private isSharedModelLane(): boolean {
    return isSharedModelLane(this.deps.settings(), this.deps.tierAEndpoint(), this.deps.tierAModel());
  }

  private focusDelayMs(): number {
    return this.isSharedModelLane() ? READING_BRIEF_SHARED_FOCUS_DELAY_MS : READING_BRIEF_FOCUS_DELAY_MS;
  }

  private retryDelayMs(): number {
    return this.isSharedModelLane() ? READING_BRIEF_SHARED_RETRY_DELAY_MS : READING_BRIEF_RETRY_DELAY_MS;
  }

  private shouldSerialize(): boolean {
    return this.isSharedModelLane();
  }
}
