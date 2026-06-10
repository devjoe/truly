import type { DashboardPostEvent, ReadingBrief } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { modelDisplayIdentity } from "../lib/model-display";
import { copyReadingBriefQuestion } from "./browser-actions";
import {
  googleSearchUrl,
  readingBriefContextRows,
  readingBriefQuestionDisplay,
  readingBriefQuestionLabel,
  readingBriefQuestionSearchQuery,
  type ReadingBriefQuestionItem,
} from "./reading-brief-text";
import {
  readingBriefFallbackRows,
  readingBriefVerificationRows,
  visibleReadingBriefQuestions,
} from "./reading-brief-visibility";

function createCopyIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
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

function appendReadingBriefList(parent: HTMLElement, title: string, rows: string[]): void {
  if (rows.length === 0) return;
  const block = document.createElement("div");
  block.className = "reading-brief-block";
  const label = document.createElement("div");
  label.className = "reading-brief-block-label";
  label.textContent = title;
  block.appendChild(label);
  const list = document.createElement("ul");
  list.className = "reading-brief-list";
  for (const rowText of rows) {
    const row = document.createElement("li");
    row.textContent = rowText;
    list.appendChild(row);
  }
  block.appendChild(list);
  parent.appendChild(block);
}

function appendReadingBriefQuestions(
  parent: HTMLElement,
  event: DashboardPostEvent,
  brief: ReadingBrief,
  questions: ReadingBriefQuestionItem[],
  lang: Lang,
): void {
  if (questions.length === 0) return;
  const block = document.createElement("div");
  block.className = "reading-brief-block";
  const label = document.createElement("div");
  label.className = "reading-brief-block-label";
  label.textContent = readingBriefQuestionLabel(event, lang);
  block.appendChild(label);

  const list = document.createElement("ul");
  list.className = "reading-brief-list reading-brief-question-list";
  for (const item of questions) {
    const displayQuestion = readingBriefQuestionDisplay(item.q);
    const searchQuery = readingBriefQuestionSearchQuery(event, item.q, brief, lang);
    const row = document.createElement("li");
    row.className = "reading-brief-question-row";

    const text = document.createElement("span");
    text.className = "reading-brief-question-text";
    text.textContent = displayQuestion;
    row.appendChild(text);

    const actions = document.createElement("span");
    actions.className = "reading-brief-question-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "reading-brief-copy-btn";
    copy.appendChild(createCopyIcon());
    copy.title = t("sidepanel.dynamic.readingBrief.copyQuestion", lang);
    copy.setAttribute("aria-label", t("sidepanel.dynamic.readingBrief.copyQuestionAria", lang, {
      question: displayQuestion,
    }));
    copy.addEventListener("click", (e) => {
      e.stopPropagation();
      copyReadingBriefQuestion(copy, displayQuestion, lang);
    });
    actions.appendChild(copy);

    const link = document.createElement("a");
    link.className = "reading-brief-google-link";
    link.href = googleSearchUrl(searchQuery);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("sidepanel.dynamic.readingBrief.askGemini", lang);
    link.setAttribute("aria-label", t("sidepanel.dynamic.readingBrief.askGeminiAria", lang, {
      query: searchQuery,
    }));
    link.title = t("sidepanel.dynamic.readingBrief.askGeminiTitle", lang);
    actions.appendChild(link);
    row.appendChild(actions);

    list.appendChild(row);
  }
  block.appendChild(list);
  parent.appendChild(block);
}

function appendReadingBriefModelNote(
  parent: HTMLElement,
  brief: ReadingBrief,
  lang: Lang,
): void {
  const modelName = modelDisplayIdentity(brief.model).label;
  if (!modelName) return;
  const note = document.createElement("div");
  note.className = "sidepanel-attribution reading-brief-model-note";
  note.textContent = t("sidepanel.dynamic.readingBrief.modelNote", lang, { model: modelName });
  if (typeof brief.elapsedMs === "number" && brief.elapsedMs > 0) {
    const elapsed = (brief.elapsedMs / 1000).toFixed(1);
    note.title = t("sidepanel.dynamic.readingBrief.modelNoteWithElapsed", lang, {
      model: modelName,
      elapsed,
    });
  } else {
    note.title = t("sidepanel.dynamic.readingBrief.modelNoteNoElapsed", lang, { model: modelName });
  }
  parent.appendChild(note);
}

export function renderReadingBriefBody(event: DashboardPostEvent, brief: ReadingBrief, lang: Lang = "zh-TW"): HTMLElement {
  const body = document.createElement("div");
  body.className = "reading-brief-body";
  const contextRows = readingBriefContextRows(brief);
  const verificationRows = readingBriefVerificationRows(event, brief, lang);
  const fallbackRows = contextRows.length === 0 && verificationRows.length === 0
    ? readingBriefFallbackRows(event, lang)
    : [];
  const visibleQuestions = visibleReadingBriefQuestions(event, brief, [
    ...contextRows,
    ...verificationRows,
    ...fallbackRows,
  ], lang);
  const visibleNote = brief.note && !contextRows.includes(brief.note) ? brief.note : null;
  const hasVisibleContent = contextRows.length > 0 ||
    verificationRows.length > 0 ||
    fallbackRows.length > 0 ||
    visibleQuestions.length > 0 ||
    Boolean(visibleNote);
  appendReadingBriefList(body, t("sidepanel.dynamic.readingBrief.context", lang), contextRows);
  if (visibleNote) {
    const note = document.createElement("div");
    note.className = "reading-brief-note";
    note.textContent = visibleNote;
    body.appendChild(note);
  }
  appendReadingBriefList(body, t("sidepanel.dynamic.readingBrief.verify", lang), verificationRows.length > 0 ? verificationRows : fallbackRows);
  appendReadingBriefQuestions(body, event, brief, visibleQuestions, lang);
  if (hasVisibleContent) appendReadingBriefModelNote(body, brief, lang);
  return body;
}
