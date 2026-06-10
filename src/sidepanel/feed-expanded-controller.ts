import type { DashboardPostEvent, UserSettings } from "../lib/types";
import type { Lang } from "../lib/types";
import { renderZhtwReviewSection } from "./card-sections";
import {
  renderFeedExpandedDetails,
  type FeedExpandedRenderOptions,
} from "./feed-expanded-renderer";
import { renderInvestigationActionSection } from "./investigation-actions-renderer";
import type { ReadingWorkspaceRuntimeState } from "./reading-workspace-decision";

export interface RenderSidepanelFeedExpandedOptions {
  event: DashboardPostEvent;
  renderOptions?: FeedExpandedRenderOptions;
  postReadingFollowupRevealedIds: Set<string>;
  renderReadingBriefSection(event: DashboardPostEvent, lang: Lang): HTMLElement | null;
  readingWorkspaceState(event: DashboardPostEvent): ReadingWorkspaceRuntimeState;
  settings?: Pick<UserSettings, "markdownDownloadMode">;
  renderReferenceSection(
    event: DashboardPostEvent,
    options: { showContextSummary?: boolean },
  ): HTMLElement | null;
}

export function renderSidepanelFeedExpanded({
  event,
  renderOptions = {},
  postReadingFollowupRevealedIds,
  renderReadingBriefSection,
  readingWorkspaceState,
  settings,
  renderReferenceSection,
}: RenderSidepanelFeedExpandedOptions): HTMLElement {
  return renderFeedExpandedDetails(event, renderOptions, {
    postReadingFollowupRevealedIds,
    renderReadingBriefSection,
    readingWorkspaceState,
    renderZhtwReviewSection: (post, lang) => renderZhtwReviewSection(post, lang),
    renderReferenceSection,
    renderInvestigationActionSection: (post, options, lang) => renderInvestigationActionSection(post, {
      ...options,
      settings,
    }, lang),
  });
}
