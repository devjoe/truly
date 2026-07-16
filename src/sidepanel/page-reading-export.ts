import type { GeneralPageBrief } from "../lib/general-page-analysis";
import type { GeneralPageModelSourceLink } from "../lib/general-page-model-context";
import type { GeneralPageEffectiveModelContextUse } from "../lib/general-page-parser-advisor";
import { t } from "../lib/i18n";
import { modelDisplayIdentity } from "../lib/model-display";
import type { Lang } from "../lib/types";
import { buildReadingBriefQuestionActionPayload } from "./reading-brief-text";

const MAX_EXPORT_LINKS = 6;

export interface PageReadingExportPacket {
  lang: Lang;
  title: string;
  url: string;
  sourceName?: string;
  authorName?: string;
  publishedAt?: string;
  caution?: string;
  excerpt?: string;
  links?: GeneralPageModelSourceLink[];
  brief: GeneralPageBrief;
  allowedUse?: GeneralPageEffectiveModelContextUse;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function markdownText(value: string): string {
  return clean(value).replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function markdownLinkLabel(value: string): string {
  return markdownText(value).replace(/\)/g, "\\)");
}

function linkLabel(link: GeneralPageModelSourceLink): string {
  const label = clean(link.text).replace(/^[•▪·●◦]+\s*/u, "");
  if (label) return label;
  try {
    return new URL(link.href).hostname.replace(/^www\./i, "") || link.href;
  } catch {
    return link.href;
  }
}

function uniqueLinks(links: GeneralPageModelSourceLink[] | undefined): GeneralPageModelSourceLink[] {
  const result: GeneralPageModelSourceLink[] = [];
  const seen = new Set<string>();
  for (const link of links ?? []) {
    const href = clean(link.href);
    if (!href) continue;
    let key = href;
    try {
      const url = new URL(href);
      url.hash = "";
      key = url.toString();
    } catch {
      // Retain non-standard URLs as-is; rendering remains text-only.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ href, text: clean(link.text) || undefined });
    if (result.length >= MAX_EXPORT_LINKS) break;
  }
  return result;
}

function heading(packet: PageReadingExportPacket): string {
  return t(
    packet.allowedUse === "page_overview_only"
      ? "sidepanel.page.analysis.overview"
      : "sidepanel.page.analysis.title",
    packet.lang,
  );
}

function modelNotice(packet: PageReadingExportPacket): string {
  const model = modelDisplayIdentity(packet.brief.model).label || packet.brief.model;
  return t("sidepanel.page.export.aiNotice", packet.lang, { model });
}

function metadataLines(packet: PageReadingExportPacket): string[] {
  const separator = packet.lang === "zh-TW" ? "：" : ": ";
  const rows: Array<[string, string | undefined]> = [
    [t("sidepanel.page.export.source", packet.lang), packet.sourceName],
    [t("sidepanel.page.export.author", packet.lang), packet.authorName],
    [t("sidepanel.page.export.publishedAt", packet.lang), packet.publishedAt],
    [t("sidepanel.page.export.url", packet.lang), packet.url],
  ];
  return rows.flatMap(([label, value]) => clean(value) ? [`${label}${separator}${clean(value)}`] : []);
}

function briefTextSections(packet: PageReadingExportPacket): string[] {
  const { brief, lang } = packet;
  const sections = ["", heading(packet), clean(brief.summary)];
  if (brief.bg?.length) {
    sections.push("", t("sidepanel.page.export.background", lang));
    for (const item of brief.bg) {
      sections.push(`• ${clean(item.t)}：${clean(item.why)}${clean(item.q) ? `（${clean(item.q)}）` : ""}`);
    }
  }
  if (brief.claims?.length) {
    sections.push("", t("sidepanel.dynamic.readingBrief.verify", lang));
    for (const claim of brief.claims) {
      sections.push(`• ${t("sidepanel.dynamic.readingBrief.needEvidence", lang, {
        claim: clean(claim.c),
        need: clean(claim.need),
      })}`);
    }
  }
  if (brief.qs?.length) {
    sections.push("", t("sidepanel.dynamic.readingBrief.questions", lang));
    for (const question of brief.qs) {
      const action = buildReadingBriefQuestionActionPayload({
        question: question.q,
        kind: question.kind,
        lang,
        source: { title: packet.title, summary: brief.summary, url: packet.url },
      });
      sections.push(`• ${clean(action.displayText)}`);
    }
  }
  if (clean(brief.note)) sections.push("", clean(brief.note));
  return sections;
}

/** Compact, human-readable projection for a quick clipboard handoff. */
export function formatCompactPageReadingExport(packet: PageReadingExportPacket): string {
  return [
    clean(packet.title) || t("sidepanel.page.untitled", packet.lang),
    ...metadataLines(packet),
    ...briefTextSections(packet),
    "",
    modelNotice(packet),
  ].join("\n");
}

/** Complete Markdown reading package without raw diagnostics or full page text. */
export function formatFullPageReadingMarkdown(packet: PageReadingExportPacket): string {
  const { brief, lang } = packet;
  const lines = [
    `# ${markdownText(packet.title) || t("sidepanel.page.untitled", lang)}`,
    "",
    ...metadataLines(packet).map((line) => `- ${markdownText(line)}`),
    "",
    `## ${markdownText(heading(packet))}`,
    "",
    markdownText(brief.summary),
  ];

  if (brief.bg?.length) {
    lines.push("", `### ${markdownText(t("sidepanel.page.export.background", lang))}`, "");
    for (const item of brief.bg) {
      lines.push(`- **${markdownText(item.t)}：** ${markdownText(item.why)}${clean(item.q) ? `（${markdownText(item.q ?? "")}）` : ""}`);
    }
  }
  if (brief.claims?.length) {
    lines.push("", `### ${markdownText(t("sidepanel.dynamic.readingBrief.verify", lang))}`, "");
    for (const claim of brief.claims) {
      lines.push(`- ${markdownText(t("sidepanel.dynamic.readingBrief.needEvidence", lang, {
        claim: clean(claim.c),
        need: clean(claim.need),
      }))}`);
    }
  }
  if (brief.qs?.length) {
    lines.push("", `### ${markdownText(t("sidepanel.dynamic.readingBrief.questions", lang))}`, "");
    for (const question of brief.qs) {
      const action = buildReadingBriefQuestionActionPayload({
        question: question.q,
        kind: question.kind,
        lang,
        source: { title: packet.title, summary: brief.summary, url: packet.url },
      });
      lines.push(`- ${markdownText(action.displayText)}`);
    }
  }
  if (clean(brief.note)) {
    lines.push("", `> ${markdownText(brief.note ?? "")}`);
  }
  if (clean(packet.caution)) {
    lines.push("", `## ${markdownText(t("sidepanel.page.export.readingNote", lang))}`, "", markdownText(packet.caution ?? ""));
  }
  if (clean(packet.excerpt)) {
    lines.push("", `## ${markdownText(t("sidepanel.page.context.pageText", lang))}`, "", markdownText(packet.excerpt ?? ""));
  }
  const links = uniqueLinks(packet.links);
  if (links.length > 0) {
    lines.push("", `## ${markdownText(t("sidepanel.page.export.sourceLinks", lang))}`, "");
    for (const link of links) lines.push(`- [${markdownLinkLabel(linkLabel(link))}](${link.href})`);
  }
  lines.push("", "---", "", markdownText(modelNotice(packet)));
  return lines.join("\n");
}
