import type { DashboardPostEvent, UserSettings } from "../lib/types";
import type { Lang } from "../lib/types";
import {
  renderAnalysisCard,
  renderAnalysisPlaceholder,
} from "./analysis-pane-renderer";
import { renderSidepanelAnalysisPane } from "./analysis-pane-controller";
import { renderSidepanelFeedExpanded } from "./feed-expanded-controller";
import { renderSidepanelReadingBriefSection } from "./reading-brief-section-controller";
import { buildReadingWorkspaceState } from "./reading-workspace-state-controller";
import { renderSidepanelReferenceSection } from "./reference-section-controller";
import type { FeedExpandedRenderOptions } from "./feed-expanded-renderer";
import type { ReadingBriefController } from "./reading-brief-controller";
import type { AnalysisPaneControllerState } from "./analysis-pane-controller";
import type { SidepanelRuntimeState } from "./runtime-state";

const defaultLang = (): Lang => "zh-TW";

type ReadingSurfacePanelState = AnalysisPaneControllerState & {
  cachedSettings: Pick<UserSettings, "markdownDownloadMode">;
};

export interface ReadingSurfaceController {
  renderFeedExpanded(
    event: DashboardPostEvent,
    history: DashboardPostEvent[],
    options?: FeedExpandedRenderOptions,
  ): HTMLElement;
  renderAnalysisPane(): void;
}

export interface CreateSidepanelReadingSurfaceOptions {
  analysisPaneEl: HTMLElement;
  runtimeState: SidepanelRuntimeState;
  panelState: ReadingSurfacePanelState;
  readingBriefController: Pick<
    ReadingBriefController,
    "scheduleCurrent" | "isInflight" | "requestGate" | "maybeTrigger" | "canRequest"
  >;
  rerenderCard(postId: string): void;
  getLang?: () => Lang;
}

export function createSidepanelReadingSurface({
  analysisPaneEl,
  runtimeState,
  panelState,
  readingBriefController,
  rerenderCard,
  getLang = defaultLang,
}: CreateSidepanelReadingSurfaceOptions): ReadingSurfaceController {
  function renderReadingBriefSection(event: DashboardPostEvent, lang: Lang): HTMLElement | null {
    return renderSidepanelReadingBriefSection({
      event,
      history: runtimeState.historyMap.get(event.id),
      controller: readingBriefController,
      revealedIds: runtimeState.readingBriefRevealedIds,
      rerenderCard,
      lang,
    });
  }

  function renderReferenceSection(
    event: DashboardPostEvent,
    options: { showContextSummary?: boolean } = {},
  ): HTMLElement | null {
    return renderSidepanelReferenceSection(event, {
      openIds: runtimeState.referenceSectionOpenIds,
      renderOptions: {
        ...options,
        lang: getLang(),
      },
    });
  }

  function renderFeedExpanded(
    event: DashboardPostEvent,
    _history: DashboardPostEvent[],
    options: FeedExpandedRenderOptions = {},
  ): HTMLElement {
    const lang = getLang();
    return renderSidepanelFeedExpanded({
      event,
      renderOptions: {
        ...options,
        lang,
      },
      postReadingFollowupRevealedIds: runtimeState.postReadingFollowupRevealedIds,
      renderReadingBriefSection,
      readingWorkspaceState: (post) => buildReadingWorkspaceState({
        event: post,
        readingBriefController,
      }),
      settings: panelState.cachedSettings,
      renderReferenceSection,
    });
  }

  function renderAnalysisPane(): void {
    const lang = getLang();
    renderSidepanelAnalysisPane({
      analysisPaneEl,
      state: panelState,
      historyMap: runtimeState.historyMap,
      referenceSectionOpenIds: runtimeState.referenceSectionOpenIds,
      readingBriefController,
      renderPlaceholder: (hasRequestedPost) => renderAnalysisPlaceholder(hasRequestedPost, lang),
      renderCard: (event, postHistory) => renderAnalysisCard(event, postHistory, {
        lang,
        renderReferenceSection: (post) => renderReferenceSection(post, { showContextSummary: false }),
        renderExpanded: (post, expandedHistory) => renderFeedExpanded(post, expandedHistory, {
          showReferenceSection: false,
        }),
      }),
    });
  }

  return {
    renderFeedExpanded,
    renderAnalysisPane,
  };
}
