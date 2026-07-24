import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import { buildEvidenceFirstInvestigationPresentation } from "../../src/lib/claim-investigation-presentation";
import type { Lang } from "../../src/lib/types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char] ?? char);
}

const labels = {
  "zh-TW": {
    title: "查核工作區預覽",
    claim: "正在釐清",
    evidence: "找到的證據",
    noEvidence: "尚未找到可回答這個問題的證據。",
    primary: "第一手來源",
    independent_secondary: "獨立報導",
    fact_check: "既有查核",
    claim_origin: "主張來源",
    user_supplied: "使用者提供",
    supports: "支持",
    refutes: "反駁",
    context: "補充脈絡",
    irrelevant: "無直接關聯",
    duplicates: (count: number) => `同源內容 ${count} 份，僅計為 1 個來源`,
    sufficiency: "證據充分性",
    currentSynthesis: "目前整理",
    origins: (count: number) => `${count} 個獨立來源`,
    unanswered: (count: number) => `${count} 個問題尚未回答`,
  },
  en: {
    title: "Investigation workspace preview",
    claim: "Clarifying",
    evidence: "Evidence found",
    noEvidence: "No evidence currently answers this question.",
    primary: "Primary source",
    independent_secondary: "Independent report",
    fact_check: "Existing fact-check",
    claim_origin: "Claim origin",
    user_supplied: "User supplied",
    supports: "Supports",
    refutes: "Refutes",
    context: "Context",
    irrelevant: "Not directly relevant",
    duplicates: (count: number) => `${count} copies share one origin and count as one source`,
    sufficiency: "Evidence sufficiency",
    currentSynthesis: "Current synthesis",
    origins: (count: number) => `${count} independent sources`,
    unanswered: (count: number) => `${count} unanswered questions`,
  },
} as const;

export function evidenceFirstInvestigationHtml(bundle: InvestigationBundle, lang: Lang = "zh-TW"): string {
  const presentation = buildEvidenceFirstInvestigationPresentation(bundle);
  if (!presentation) return "";
  const text = labels[lang === "en" ? "en" : "zh-TW"];
  const questions = presentation.questionGroups.map((group, index) => {
    const evidence = group.evidence.length
      ? group.evidence.map((artifact) => `
          <article class="investigation-evidence-card" data-source-role="${artifact.sourceRole}" data-relation="${artifact.relation}">
            <div class="investigation-evidence-meta">
              <span>${escapeHtml(text[artifact.sourceRole])}</span>
              <span aria-hidden="true">·</span>
              <span>${escapeHtml(text[artifact.relation])}</span>
              ${artifact.publisher ? `<span aria-hidden="true">·</span><span>${escapeHtml(artifact.publisher)}</span>` : ""}
            </div>
            <blockquote>${escapeHtml(artifact.exactExcerpt)}</blockquote>
            ${artifact.duplicateCount > 1 ? `<p class="investigation-evidence-duplicate">${escapeHtml(text.duplicates(artifact.duplicateCount))}</p>` : ""}
          </article>`).join("")
      : `<p class="investigation-evidence-empty">${escapeHtml(text.noEvidence)}</p>`;
    return `
      <section class="investigation-question-group" aria-labelledby="investigation-question-${index + 1}">
        <div class="investigation-question-kicker">${index + 1}</div>
        <h3 id="investigation-question-${index + 1}">${escapeHtml(group.question)}</h3>
        <div class="investigation-question-evidence" aria-label="${escapeHtml(text.evidence)}">${evidence}</div>
      </section>`;
  }).join("");
  return `
    <section class="evidence-first-investigation" data-investigation-prototype="true">
      <header class="investigation-subject">
        <p class="investigation-eyebrow">${escapeHtml(text.title)}</p>
        <span>${escapeHtml(text.claim)}</span>
        <h2>${escapeHtml(presentation.subject)}</h2>
        <p class="investigation-ledger-meta">${escapeHtml(text.origins(presentation.independentOriginCount))} · ${escapeHtml(text.unanswered(presentation.unansweredQuestionCount))}</p>
      </header>
      <div class="investigation-question-list">${questions}</div>
      ${presentation.sufficiency ? `
        <section class="investigation-sufficiency" data-state="${presentation.sufficiency.state}">
          <h3>${escapeHtml(text.sufficiency)}</h3>
          <p>${escapeHtml(presentation.sufficiency.rationale)}</p>
        </section>` : ""}
      ${presentation.finding ? `
        <section class="investigation-finding" data-state="${presentation.finding.state}">
          <h3>${escapeHtml(text.currentSynthesis)}</h3>
          <p>${escapeHtml(presentation.finding.summary)}</p>
        </section>` : ""}
    </section>`;
}
