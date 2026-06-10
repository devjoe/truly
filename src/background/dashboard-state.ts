import type { DashboardPostEvent } from "../lib/types";
import { normalizeStructuredPostContext } from "../lib/source-context-normalizer";

export type DashboardEventPatch = Partial<
  Pick<
    DashboardPostEvent,
    "readingBrief" | "readingBriefPending" | "readingBriefStale" | "readingBriefError"
  >
>;

export class DashboardRuntimeState {
  private readonly buffer: DashboardPostEvent[] = [];
  private readonly bufferIndex = new Map<string, number>();
  private readonly openSidePanelWindows = new Set<number>();
  private readonly sidePanelPostByWindow = new Map<number, string>();

  constructor(private readonly maxEvents = 300) {}

  bufferEvent(event: DashboardPostEvent): void {
    const sanitizedEvent = sanitizeDashboardPostEvent(event);
    const existingIdx = this.bufferIndex.get(event.id);
    if (existingIdx !== undefined) {
      this.buffer[existingIdx] = sanitizedEvent;
      return;
    }
    this.buffer.push(sanitizedEvent);
    this.bufferIndex.set(event.id, this.buffer.length - 1);
    while (this.buffer.length > this.maxEvents) {
      const dropped = this.buffer.shift();
      if (dropped) this.bufferIndex.delete(dropped.id);
      this.reindexBuffer();
    }
  }

  replayEvents(): DashboardPostEvent[] {
    return this.buffer.slice();
  }

  patchEvent(postId: string, patch: DashboardEventPatch): DashboardPostEvent | null {
    const existingIdx = this.bufferIndex.get(postId);
    if (existingIdx === undefined) return null;
    const next: DashboardPostEvent = {
      ...this.buffer[existingIdx],
      ...patch,
    };
    this.buffer[existingIdx] = next;
    return next;
  }

  markPanelOpen(windowId: number): void {
    this.openSidePanelWindows.add(windowId);
  }

  markPanelClosed(windowId: number): void {
    this.openSidePanelWindows.delete(windowId);
    this.sidePanelPostByWindow.delete(windowId);
  }

  rememberPanelPost(windowId: number, postId: string): void {
    this.openSidePanelWindows.add(windowId);
    this.sidePanelPostByWindow.set(windowId, postId);
  }

  isPanelOpen(windowId: number): boolean {
    return this.openSidePanelWindows.has(windowId);
  }

  isPanelOpenForPost(windowId: number, postId: string): boolean {
    return this.openSidePanelWindows.has(windowId) && this.sidePanelPostByWindow.get(windowId) === postId;
  }

  private reindexBuffer(): void {
    for (let i = 0; i < this.buffer.length; i++) {
      this.bufferIndex.set(this.buffer[i].id, i);
    }
  }
}

function sanitizeDashboardPostEvent(event: DashboardPostEvent): DashboardPostEvent {
  if (event.sourceContext === undefined) return event;
  const sourceContext = normalizeStructuredPostContext(event.sourceContext);
  return {
    ...event,
    sourceContext,
  };
}
