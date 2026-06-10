import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import type { InvestigationActionRendererOptions } from "./investigation-actions-renderer";
import { shouldShowInvestigationActionSection } from "./investigation-actions-renderer";
import type { ReadingWorkspaceRuntimeState } from "./reading-workspace-decision";
import { shouldShowPostReadingSections } from "./reading-workspace-decision";

export interface FeedExpandedRenderOptions {
  showReferenceSummary?: boolean;
  showReferenceSection?: boolean;
  lang?: Lang;
}

export interface FeedExpandedRenderDeps {
  postReadingFollowupRevealedIds: Set<string>;
  renderReadingBriefSection(event: DashboardPostEvent, lang: Lang): HTMLElement | null;
  readingWorkspaceState(event: DashboardPostEvent): ReadingWorkspaceRuntimeState;
  renderZhtwReviewSection(event: DashboardPostEvent, lang: Lang): HTMLElement | null;
  renderReferenceSection(
    event: DashboardPostEvent,
    options: { showContextSummary?: boolean },
  ): HTMLElement | null;
  renderInvestigationActionSection(
    event: DashboardPostEvent,
    options: InvestigationActionRendererOptions,
    lang: Lang,
  ): HTMLElement;
}

function applyPostReadingReveal(
  el: HTMLElement,
  event: DashboardPostEvent,
  index: number,
  revealedIds: Set<string>,
): void {
  if (!event.readingBrief || revealedIds.has(event.id)) return;
  el.classList.add("sidepanel-reveal-step");
  el.style.setProperty("--truly-reveal-index", String(index));
}

export function renderFeedExpandedDetails(
  event: DashboardPostEvent,
  options: FeedExpandedRenderOptions,
  deps: FeedExpandedRenderDeps,
): HTMLElement {
  const details = document.createElement("div");
  details.className = "post-details";
  const lang = options.lang ?? "zh-TW";
  const brief = deps.renderReadingBriefSection(event, lang);
  if (brief) details.appendChild(brief);
  const workspaceState = deps.readingWorkspaceState(event);
  const showPostReadingSections = shouldShowPostReadingSections(event, workspaceState);
  const revealFollowup = Boolean(
    event.readingBrief && !deps.postReadingFollowupRevealedIds.has(event.id),
  );
  let revealIndex = 1;
  const appendPostReadingSection = (section: HTMLElement): void => {
    if (revealFollowup) {
      applyPostReadingReveal(section, event, revealIndex++, deps.postReadingFollowupRevealedIds);
    }
    details.appendChild(section);
  };

  if (showPostReadingSections) {
    const zhtwReview = deps.renderZhtwReviewSection(event, lang);
    if (zhtwReview) appendPostReadingSection(zhtwReview);
  }
  if (options.showReferenceSection !== false) {
    const reference = deps.renderReferenceSection(event, {
      showContextSummary: options.showReferenceSummary,
    });
    if (reference) details.appendChild(reference);
  }
  if (shouldShowInvestigationActionSection(event, workspaceState)) {
    appendPostReadingSection(deps.renderInvestigationActionSection(event, {
      runtimeState: workspaceState,
    }, lang));
  }
  if (revealFollowup) deps.postReadingFollowupRevealedIds.add(event.id);
  return details;
}
