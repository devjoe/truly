import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { resolveStructuredPostContext } from "../lib/post-context";
import { splitFacebookImageAltText } from "../lib/post-text";
import {
  displayEventText,
  formatElapsed,
  referenceMaterialLabels,
  referenceRelationshipText,
} from "./format";

/**
 * Descriptions for the LLM's content category scores. Shown as a tooltip
 * when the user hovers over a category chip in the collapsed/expanded card.
 */
const CATEGORY_KEYS: Record<string, string> = {
  commercial: "commercial",
  political: "political",
  emotional: "emotional",
  personal: "personal",
};

export function categoryLabel(cat: string, lang: Lang = "zh-TW"): string {
  const key = CATEGORY_KEYS[cat];
  return key ? t(`sidepanel.dynamic.category.${key}`, lang) : cat;
}

export function categoryTooltip(cat: string, score: number, lang: Lang = "zh-TW"): string {
  const key = CATEGORY_KEYS[cat];
  const desc = key ? t(`sidepanel.dynamic.categoryDesc.${key}`, lang) : cat;
  return `${desc}\n\n${t("sidepanel.dynamic.categoryTooltip.score", lang, {
    score: score.toFixed(2),
  })}`;
}

export function tierLabel(tier?: number, lang: Lang = "zh-TW"): string {
  if (tier === 3) return t("sidepanel.dynamic.tier.readingPrompt", lang);
  if (tier === 1) return t("sidepanel.dynamic.tier.fastRule", lang);
  return "?";
}

function renderTextValue(text: string, extraClass = "", lang: Lang = "zh-TW"): HTMLElement {
  const textValue = document.createElement("div");
  textValue.className = `details-fulltext${extraClass ? ` ${extraClass}` : ""}`;
  textValue.textContent = text || t("sidepanel.dynamic.noText", lang);
  return textValue;
}

function renderTextSection(labelText: string, text: string, extraClass = "", lang: Lang = "zh-TW"): HTMLElement {
  const section = document.createElement("div");
  section.className = "details-section";
  const label = document.createElement("div");
  label.className = "details-label";
  label.textContent = labelText;
  section.appendChild(label);
  section.appendChild(renderTextValue(text, extraClass, lang));
  return section;
}

function renderCollapsibleTextSection(labelText: string, text: string, extraClass = "", lang: Lang = "zh-TW"): HTMLElement {
  const details = document.createElement("details");
  details.className = "details-section details-collapsible";
  const summary = document.createElement("summary");
  summary.className = "details-label details-collapsible-label";
  summary.textContent = labelText;
  details.appendChild(summary);
  details.appendChild(renderTextValue(text, extraClass, lang));
  return details;
}

export function renderFullTextSections(event: DashboardPostEvent, lang: Lang = "zh-TW"): HTMLElement[] {
  const context = resolveStructuredPostContext(event);
  const imageTexts: string[] = [];
  const imageAltTexts: string[] = [];
  imageTexts.push(...context.imageTexts);
  imageAltTexts.push(...context.imageAltTexts);
  const appendImageTexts = (raw: string | undefined) => {
    const split = splitFacebookImageAltText(raw ?? "");
    imageTexts.push(...split.imageTexts);
    imageAltTexts.push(...split.imageAltTexts);
    return split.bodyText;
  };
  if (context.isShare) {
    const sections: HTMLElement[] = [];
    const sharerComment = appendImageTexts(context.sharerComment);
    sections.push(renderTextSection(
      t("sidepanel.dynamic.reference.sharerComment", lang),
      sharerComment || t("sidepanel.dynamic.reference.noSharerComment", lang),
      "",
      lang,
    ));
    if (context.sharedContent) {
      const originalLabel = context.originalAuthor
        ? t("sidepanel.dynamic.reference.originalPostBy", lang, { author: context.originalAuthor })
        : t("sidepanel.dynamic.reference.sharedContent", lang);
      const sharedContent = appendImageTexts(context.sharedContent);
      if (sharedContent) {
        sections.push(renderCollapsibleTextSection(originalLabel, sharedContent.slice(0, 1000), "reshare-original", lang));
      }
    } else if (context.originalAuthor && event.hasMedia && !context.linkPreview) {
      sections.push(renderCollapsibleTextSection(
        t("sidepanel.dynamic.reference.originalPostBy", lang, { author: context.originalAuthor }),
        t("sidepanel.dynamic.reference.emptySharedPost", lang),
        "reshare-original reshare-original-empty",
        lang,
      ));
    }
    if (context.linkPreview) {
      const preview = appendImageTexts(context.linkPreview);
      if (preview) {
        sections.push(renderCollapsibleTextSection(
          t("sidepanel.dynamic.reference.linkPreview", lang),
          preview.slice(0, 1000),
          "link-preview",
          lang,
        ));
      }
    }
    for (const text of [...new Set(imageTexts)]) {
      sections.push(renderCollapsibleTextSection(
        t("sidepanel.dynamic.reference.imageText", lang),
        text.slice(0, 1000),
        "image-text",
        lang,
      ));
    }
    for (const text of [...new Set(imageAltTexts)]) {
      sections.push(renderCollapsibleTextSection(
        t("sidepanel.dynamic.reference.imageAlt", lang),
        text.slice(0, 1000),
        "image-alt-text",
        lang,
      ));
    }
    return sections;
  }

  const split = splitFacebookImageAltText(context.ownText || displayEventText(event, lang));
  const sections = [renderCollapsibleTextSection(
    t("sidepanel.dynamic.reference.fullPost", lang),
    split.bodyText || t("sidepanel.dynamic.noText", lang),
    "",
    lang,
  )];
  if (context.linkPreview) {
    const preview = appendImageTexts(context.linkPreview);
    if (preview) {
      sections.push(renderCollapsibleTextSection(
        t("sidepanel.dynamic.reference.linkPreview", lang),
        preview.slice(0, 1000),
        "link-preview",
        lang,
      ));
    }
  }
  for (const text of [...new Set([...imageTexts, ...split.imageTexts])]) {
    sections.push(renderCollapsibleTextSection(
      t("sidepanel.dynamic.reference.imageText", lang),
      text.slice(0, 1000),
      "image-text",
      lang,
    ));
  }
  for (const text of [...new Set([...imageAltTexts, ...split.imageAltTexts])]) {
    sections.push(renderCollapsibleTextSection(
      t("sidepanel.dynamic.reference.imageAlt", lang),
      text.slice(0, 1000),
      "image-alt-text",
      lang,
    ));
  }
  return sections;
}

export function renderReferenceContextSummary(event: DashboardPostEvent, lang: Lang = "zh-TW"): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "reference-context-summary";

  const relation = document.createElement("div");
  relation.className = "reference-relation";
  relation.textContent = referenceRelationshipText(event, lang);
  wrap.appendChild(relation);

  const materials = document.createElement("div");
  materials.className = "reference-materials";
  materials.textContent = t("sidepanel.dynamic.reference.includes", lang, {
    materials: referenceMaterialLabels(event, lang).join(lang === "zh-TW" ? "、" : ", "),
  });
  wrap.appendChild(materials);

  if (event.textCompleteness === "likely_truncated") {
    const hint = document.createElement("div");
    hint.className = "reference-completeness-hint";
    const isShare = event.contentKind === "share_without_comment" || event.contentKind === "reshare_with_comment";
    hint.textContent = isShare
      ? t("sidepanel.dynamic.reference.truncatedShare", lang)
      : t("sidepanel.dynamic.reference.truncatedPost", lang);
    hint.setAttribute("role", "note");
    wrap.appendChild(hint);
  }

  return wrap;
}

export function renderMetadataSection(event: DashboardPostEvent): HTMLElement {
  const metaSection = document.createElement("div");
  metaSection.className = "details-section";
  const metaLabel = document.createElement("div");
  metaLabel.className = "details-label";
  metaLabel.textContent = "Metadata";
  const metaValue = document.createElement("div");
  metaValue.className = "details-meta";
  const metaParts: string[] = [];
  metaParts.push(`id: ${event.id}`);
  metaParts.push(`sponsored: ${event.isSponsored ? "yes" : "no"}`);
  metaParts.push(`media: ${event.hasMedia ? "yes" : "no"}`);
  metaParts.push(`filtered: ${event.decision.filtered ? "yes" : "no"}`);
  if (event.postType) metaParts.push(`type: ${event.postType}`);
  if (event.contentKind) metaParts.push(`content: ${event.contentKind}`);
  if (event.decision.reason) metaParts.push(`reason: ${event.decision.reason}`);
  metaValue.textContent = metaParts.join(" · ");
  metaSection.appendChild(metaLabel);
  metaSection.appendChild(metaValue);
  return metaSection;
}

export function renderDecisionTrailSection(
  history: DashboardPostEvent[],
  lang: Lang = "zh-TW",
): HTMLElement | null {
  if (history.length === 0) return null;
  const trailSection = document.createElement("div");
  trailSection.className = "details-section";
  const trailLabel = document.createElement("div");
  trailLabel.className = "details-label";
  trailLabel.textContent = `Decision trail (${history.length} update${history.length > 1 ? "s" : ""})`;
  trailSection.appendChild(trailLabel);

  const seen = new Set<string>();
  for (const h of history) {
    const key = `${h.decision.tier ?? "?"}:${h.elapsedMs}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const row = document.createElement("div");
    row.className = "trail-row";
    const tierBadge = document.createElement("span");
    tierBadge.className = "tier-badge tier-badge-small";
    tierBadge.textContent = tierLabel(h.decision.tier, lang);
    const elapsedChip = document.createElement("span");
    elapsedChip.className = "chip chip-elapsed";
    elapsedChip.textContent = formatElapsed(h.elapsedMs);
    const primary = document.createElement("span");
    primary.className = "trail-primary";
    if (h.decision.primaryCategory) {
      primary.textContent = `${categoryLabel(h.decision.primaryCategory, lang)} ${(h.decision.primaryScore ?? 0).toFixed(2)}`;
    } else {
      primary.textContent = "(no primary)";
    }
    row.appendChild(tierBadge);
    row.appendChild(elapsedChip);
    row.appendChild(primary);
    trailSection.appendChild(row);
  }
  return trailSection;
}

export function renderRawDecisionSection(event: DashboardPostEvent): HTMLElement {
  const jsonSection = document.createElement("div");
  jsonSection.className = "details-section";
  const jsonLabel = document.createElement("div");
  jsonLabel.className = "details-label";
  jsonLabel.textContent = "Raw decision";
  const jsonValue = document.createElement("pre");
  jsonValue.className = "details-json";
  jsonValue.textContent = JSON.stringify(event.decision, null, 2);
  jsonSection.appendChild(jsonLabel);
  jsonSection.appendChild(jsonValue);
  return jsonSection;
}
