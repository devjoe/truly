import type { DashboardPostEvent } from "../lib/types";
import {
  renderReferenceSectionElement,
  type ReferenceSectionRenderOptions,
} from "./reference-section-renderer";

export interface RenderSidepanelReferenceSectionOptions {
  openIds: Set<string>;
  renderOptions?: Omit<ReferenceSectionRenderOptions, "open" | "onOpenChange">;
}

export function renderSidepanelReferenceSection(
  event: DashboardPostEvent,
  { openIds, renderOptions = {} }: RenderSidepanelReferenceSectionOptions,
): HTMLElement | null {
  return renderReferenceSectionElement(event, {
    ...renderOptions,
    open: openIds.has(event.id),
    onOpenChange: (open) => {
      if (open) {
        openIds.add(event.id);
      } else {
        openIds.delete(event.id);
      }
    },
  });
}
