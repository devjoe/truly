import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import type { ReadingBriefController } from "./reading-brief-controller";
import { prepareReadingBriefRetry } from "./reading-brief-retry-state";
import { renderReadingBriefSectionElement } from "./reading-brief-section-renderer";

export interface RenderSidepanelReadingBriefSectionOptions {
  event: DashboardPostEvent;
  history?: DashboardPostEvent[];
  controller: Pick<ReadingBriefController, "isInflight" | "requestGate" | "maybeTrigger">;
  revealedIds: Set<string>;
  rerenderCard(postId: string): void;
  lang?: Lang;
}

export function renderSidepanelReadingBriefSection({
  event,
  history,
  controller,
  revealedIds,
  rerenderCard,
  lang,
}: RenderSidepanelReadingBriefSectionOptions): HTMLElement | null {
  const pending = event.readingBriefPending || controller.isInflight(event.id);
  return renderReadingBriefSectionElement({
    event,
    pending,
    requestGate: controller.requestGate(event),
    revealedIds,
    lang,
    onRetry: () => {
      const { cleaned } = prepareReadingBriefRetry({ event, history });
      controller.maybeTrigger(cleaned);
      rerenderCard(event.id);
    },
  });
}
