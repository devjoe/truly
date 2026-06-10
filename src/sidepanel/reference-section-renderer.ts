import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import {
  renderFullTextSections,
  renderReferenceContextSummary,
} from "./card-leaf-sections";

export interface ReferenceSectionRenderOptions {
  showContextSummary?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  lang?: Lang;
}

export function renderReferenceSectionElement(
  event: DashboardPostEvent,
  options: ReferenceSectionRenderOptions = {},
): HTMLElement | null {
  const lang = options.lang ?? "zh-TW";
  const sections = renderFullTextSections(event, lang);
  if (sections.length === 0) return null;

  const details = document.createElement("details");
  details.className = "details-section details-collapsible reference-section";
  details.open = options.open === true;
  details.addEventListener("toggle", () => {
    options.onOpenChange?.(details.open);
  });

  const label = document.createElement("summary");
  label.className = "details-label details-collapsible-label investigation-section-label";
  label.textContent = t("sidepanel.dynamic.reference.title", lang);
  details.appendChild(label);

  const body = document.createElement("div");
  body.className = "investigation-section-body";
  if (options.showContextSummary !== false) body.appendChild(renderReferenceContextSummary(event, lang));
  for (const section of sections) body.appendChild(section);
  details.appendChild(body);
  return details;
}
