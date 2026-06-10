import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { renderReferenceContextSummary } from "./card-leaf-sections";

export interface AnalysisPaneCardRenderOptions {
  lang?: Lang;
  renderReferenceSection: (event: DashboardPostEvent) => HTMLElement | null;
  renderExpanded: (event: DashboardPostEvent, history: DashboardPostEvent[]) => HTMLElement;
}

export function renderAnalysisPlaceholder(hasRequestedPost: boolean, lang: Lang = "zh-TW"): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.id = "analysisPlaceholder";
  placeholder.textContent = hasRequestedPost
    ? t("sidepanel.dynamic.placeholder.syncing", lang)
    : t("sidepanel.dynamic.placeholder.waiting", lang);
  return placeholder;
}

export function renderAnalysisCard(
  event: DashboardPostEvent,
  history: DashboardPostEvent[],
  options: AnalysisPaneCardRenderOptions,
): HTMLElement {
  const lang = options.lang ?? "zh-TW";
  const card = document.createElement("div");
  card.className = "post-card analysis-card expanded" + (event.isSponsored ? " sponsored" : "");
  card.setAttribute("data-truly-dash-id", event.id);

  card.appendChild(renderReferenceContextSummary(event, lang));
  const reference = options.renderReferenceSection(event);
  if (reference) card.appendChild(reference);
  card.appendChild(options.renderExpanded(event, history));
  return card;
}
