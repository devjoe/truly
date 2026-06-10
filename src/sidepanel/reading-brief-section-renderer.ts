import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import type { ReadingBriefRequestGate } from "./reading-brief-gate";
import { renderReadingBriefBody } from "./reading-brief-renderer";

export interface ReadingBriefSectionRenderOptions {
  event: DashboardPostEvent;
  pending: boolean;
  requestGate: ReadingBriefRequestGate;
  revealedIds: Set<string>;
  onRetry(event: DashboardPostEvent): void;
  lang?: Lang;
}

export function renderReadingBriefSectionElement({
  event,
  pending,
  requestGate,
  revealedIds,
  onRetry,
  lang = "zh-TW",
}: ReadingBriefSectionRenderOptions): HTMLElement | null {
  const brief = event.readingBrief;
  const queued = !brief && !pending && !event.readingBriefError && requestGate.canRequest;
  const unsupportedReadingBrief = Boolean(
    event.decision.deepClassification &&
    requestGate.featureGate.blockedStatus === "unsupported" &&
    !brief &&
    !pending &&
    !event.readingBriefError &&
    !queued,
  );
  if (!brief && !pending && !event.readingBriefError && !queued && !unsupportedReadingBrief) return null;

  const section = document.createElement("div");
  section.className = "details-section reading-brief-section";

  if (unsupportedReadingBrief) {
    const note = document.createElement("div");
    note.className = "reading-brief-muted-note";
    note.textContent = t("sidepanel.dynamic.readingBrief.unsupported", lang);
    section.appendChild(note);
    return section;
  }

  if ((pending || queued) && !brief) {
    const loading = document.createElement("div");
    loading.className = "reading-brief-loading";
    loading.textContent = t("sidepanel.dynamic.readingBrief.loading", lang);
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.setAttribute("aria-busy", "true");
    section.appendChild(loading);
    return section;
  }

  if (!brief) {
    const error = document.createElement("div");
    error.className = "reading-brief-error";
    error.textContent = t("sidepanel.dynamic.readingBrief.error", lang);
    section.appendChild(error);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn-investigation-secondary btn-reading-brief-retry";
    retry.textContent = t("sidepanel.dynamic.readingBrief.retry", lang);
    retry.dataset.tooltip = t("sidepanel.dynamic.readingBrief.retryTooltip", lang);
    retry.addEventListener("click", (e) => {
      e.stopPropagation();
      onRetry(event);
    });
    section.appendChild(retry);
    return section;
  }

  if (pending || event.readingBriefStale) {
    const updating = document.createElement("div");
    updating.className = `reading-brief-update-status${pending ? "" : " stale"}`;
    updating.textContent = pending
      ? t("sidepanel.dynamic.readingBrief.updating", lang)
      : t("sidepanel.dynamic.readingBrief.stale", lang);
    updating.dataset.state = pending ? "updating" : "stale";
    updating.title = pending
      ? t("sidepanel.dynamic.readingBrief.updatingTitle", lang)
      : t("sidepanel.dynamic.readingBrief.staleTitle", lang);
    updating.setAttribute("role", "status");
    updating.setAttribute("aria-live", "polite");
    updating.setAttribute("aria-busy", pending ? "true" : "false");
    section.appendChild(updating);
  }

  const body = renderReadingBriefBody(event, brief, lang);
  if (body.childElementCount === 0 && section.childElementCount === 0) return null;
  if (!revealedIds.has(event.id)) {
    section.classList.add("sidepanel-reveal-step", "sidepanel-reveal-reading");
    section.style.setProperty("--truly-reveal-index", "0");
    revealedIds.add(event.id);
  }
  if (body.childElementCount > 0) section.appendChild(body);
  return section;
}
