import type { DashboardPostEvent, UserSettings } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import {
  buildInvestigationMarkdownFilename,
  copyTextToClipboard,
  openExternalToolUrl,
  saveMarkdownTextFile,
} from "./browser-actions";
import {
  buildPostInvestigationContext,
  formatMetaAiAnalysisPrompt,
  formatInvestigationMarkdown,
  META_AI_URL,
} from "./investigation-context";
import {
  resolveInvestigationActionDecision,
  type ReadingWorkspaceRuntimeState,
} from "./reading-workspace-decision";

export interface InvestigationActionRendererOptions {
  runtimeState: ReadingWorkspaceRuntimeState;
  settings?: Pick<UserSettings, "markdownDownloadMode">;
  logger?: Pick<Console, "warn">;
}

export function shouldShowInvestigationActionSection(
  event: DashboardPostEvent,
  runtimeState: ReadingWorkspaceRuntimeState,
): boolean {
  return resolveInvestigationActionDecision(event, runtimeState).showSection;
}

function createIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "btn-investigation-icon btn-investigation-icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function createCopyIcon(): SVGSVGElement {
  const svg = createIcon([]);
  const back = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  back.setAttribute("x", "4");
  back.setAttribute("y", "4");
  back.setAttribute("width", "11");
  back.setAttribute("height", "11");
  back.setAttribute("rx", "2");
  const front = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  front.setAttribute("x", "9");
  front.setAttribute("y", "9");
  front.setAttribute("width", "11");
  front.setAttribute("height", "11");
  front.setAttribute("rx", "2");
  svg.appendChild(back);
  svg.appendChild(front);
  return svg;
}

function createDownloadIcon(): SVGSVGElement {
  return createIcon(["M12 3v12", "M8 11l4 4 4-4", "M5 21h14"]);
}

function createMessageCircleIcon(): SVGSVGElement {
  const svg = createIcon([
    "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
    "M9 9h6",
    "M9 13h4",
  ]);
  return svg;
}

function appendActionLabel(button: HTMLButtonElement, icon: string | SVGSVGElement, text: string): void {
  button.textContent = "";
  const iconEl = typeof icon === "string"
    ? document.createElement("span")
    : icon;
  if (typeof icon === "string") {
    iconEl.setAttribute("class", "btn-investigation-icon");
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
  }
  const textEl = document.createElement("span");
  textEl.className = "btn-investigation-text";
  textEl.textContent = text;
  button.appendChild(iconEl);
  button.appendChild(textEl);
  button.setAttribute("aria-label", text);
}

export function renderInvestigationActionSection(
  event: DashboardPostEvent,
  options: InvestigationActionRendererOptions,
  lang: Lang = "zh-TW",
): HTMLElement {
  const logger = options.logger ?? console;
  const section = document.createElement("div");
  section.className = "details-section investigation-actions";

  const label = document.createElement("div");
  label.className = "details-label investigation-actions-label";
  label.textContent = t("sidepanel.dynamic.actions.title", lang);
  section.appendChild(label);

  const hint = document.createElement("div");
  hint.className = "investigation-actions-hint";
  hint.textContent = t("sidepanel.dynamic.actions.hint", lang);
  section.appendChild(hint);

  const row = document.createElement("div");
  row.className = "investigation-action-row";

  const status = document.createElement("span");
  status.className = "investigation-action-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const createCopyButton = (): HTMLButtonElement => {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-investigation-secondary";
    appendActionLabel(copyBtn, createCopyIcon(), t("sidepanel.dynamic.actions.copy", lang));
    copyBtn.setAttribute("aria-label", t("sidepanel.dynamic.actions.copyAria", lang));
    copyBtn.dataset.tooltip = t("sidepanel.dynamic.actions.copyTooltip", lang);

    copyBtn.addEventListener("click", async () => {
      copyBtn.disabled = true;
      status.textContent = t("sidepanel.dynamic.actions.copying", lang);
      try {
        const context = buildPostInvestigationContext(event, lang);
        await copyTextToClipboard(formatInvestigationMarkdown(context, lang));
        status.textContent = t("sidepanel.dynamic.actions.copied", lang);
      } catch (err) {
        logger.warn("[Truly Sidepanel] Markdown copy failed:", err);
        status.textContent = t("sidepanel.dynamic.actions.copyFailed", lang);
      } finally {
        copyBtn.disabled = false;
      }
    });

    return copyBtn;
  };

  const createDownloadButton = (): HTMLButtonElement => {
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "btn-investigation-secondary";
    appendActionLabel(downloadBtn, createDownloadIcon(), t("sidepanel.dynamic.actions.download", lang));
    downloadBtn.setAttribute("aria-label", t("sidepanel.dynamic.actions.downloadAria", lang));
    downloadBtn.dataset.tooltip = t("sidepanel.dynamic.actions.downloadTooltip", lang);

    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      status.textContent = t("sidepanel.dynamic.actions.preparingDownload", lang);
      try {
        const context = buildPostInvestigationContext(event, lang);
        const markdown = formatInvestigationMarkdown(context, lang);
        const outcome = await saveMarkdownTextFile(
          markdown,
          buildInvestigationMarkdownFilename(event),
          "text/markdown;charset=utf-8",
          { mode: options.settings?.markdownDownloadMode },
        );
        status.textContent = outcome === "cancelled"
          ? t("sidepanel.dynamic.actions.downloadCancelled", lang)
          : t("sidepanel.dynamic.actions.downloaded", lang);
      } catch (err) {
        logger.warn("[Truly Sidepanel] Markdown download failed:", err);
        status.textContent = t("sidepanel.dynamic.actions.downloadFailed", lang);
      } finally {
        downloadBtn.disabled = false;
      }
    });

    return downloadBtn;
  };

  row.appendChild(createCopyButton());
  row.appendChild(createDownloadButton());
  const metaAiBtn = document.createElement("button");
  metaAiBtn.type = "button";
  metaAiBtn.className = "btn-investigation-secondary";
  appendActionLabel(metaAiBtn, createMessageCircleIcon(), t("sidepanel.dynamic.actions.askMetaAi", lang));
  metaAiBtn.setAttribute("aria-label", t("sidepanel.dynamic.actions.askMetaAi", lang));
  metaAiBtn.dataset.tooltip = t("sidepanel.dynamic.actions.askMetaAiTooltip", lang);
  metaAiBtn.addEventListener("click", async () => {
    metaAiBtn.disabled = true;
    status.textContent = t("sidepanel.dynamic.actions.copying", lang);
    try {
      const context = buildPostInvestigationContext(event, lang);
      await copyTextToClipboard(formatMetaAiAnalysisPrompt(context, lang));
      const opened = openExternalToolUrl(META_AI_URL);
      status.textContent = opened
        ? t("sidepanel.dynamic.actions.metaAiCopiedOpened", lang)
        : t("sidepanel.dynamic.actions.metaAiCopiedManual", lang);
    } catch (err) {
      logger.warn("[Truly Sidepanel] Meta AI handoff failed:", err);
      status.textContent = t("sidepanel.dynamic.actions.copyFailed", lang);
    } finally {
      metaAiBtn.disabled = false;
    }
  });
  row.appendChild(metaAiBtn);

  section.appendChild(row);
  section.appendChild(status);
  return section;
}
