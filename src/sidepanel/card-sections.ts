// Self-contained sidepanel view renderers: data → DOM, no module state and no
// orchestration. Each cluster owns its private constants. The controller-layer
// composite renderers in sidepanel.ts call these and decide when to show them.
import type {
  DashboardPostEvent,
} from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import {
  summarizeZhtwFindingsForSidePanel,
  zhtwRuleTypeLabel,
  type ZhtwSidePanelFinding,
  type ZhtwSidePanelFindingGroup,
} from "../lib/zhtw-review";

// --- Tier A-2 (zhtw-mcp) language-convention review ---------------------------

const ZHTW_FINDING_TAB_KEY: Record<ZhtwSidePanelFindingGroup, string> = {
  lexical: "lexical",
  style: "style",
  punctuation: "punctuation",
  other: "other",
};

const ZHTW_FINDING_TAB_ORDER: ZhtwSidePanelFindingGroup[] = ["lexical", "style", "punctuation", "other"];
const ZHTW_FINDING_SCROLL_THRESHOLD = 10;
let zhtwTabIdCounter = 0;

export function renderZhtwReviewSection(event: DashboardPostEvent, lang: Lang = "zh-TW"): HTMLElement | null {
  if (lang !== "zh-TW") return null;
  const review = event.zhtwReview ?? event.decision.zhtwReview;
  if (!review || review.issueCount === 0) return null;
  const findings = summarizeZhtwFindingsForSidePanel(review);
  if (findings.length === 0) return null;

  const section = document.createElement("section");
  section.className = "details-section zhtw-review-section";

  const label = document.createElement("div");
  label.className = "details-label";
  label.textContent = t("sidepanel.dynamic.zhtw.title", lang);
  section.appendChild(label);

  const summary = document.createElement("div");
  summary.className = "zhtw-review-summary";
  summary.textContent = t("sidepanel.dynamic.zhtw.summary", lang, { count: findings.length });
  section.appendChild(summary);

  section.appendChild(renderZhtwFindingTabs(findings, lang));

  const caution = document.createElement("div");
  caution.className = "zhtw-review-caution";
  caution.textContent = t("sidepanel.dynamic.zhtw.caution", lang);
  section.appendChild(caution);

  const attribution = document.createElement("div");
  attribution.className = "sidepanel-attribution zhtw-review-attribution";
  attribution.appendChild(document.createTextNode(t("sidepanel.dynamic.zhtw.poweredBy", lang)));
  const link = document.createElement("a");
  link.href = "https://github.com/sysprog21/zhtw-mcp";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "zhtw-mcp";
  attribution.appendChild(link);
  section.appendChild(attribution);
  return section;
}

function renderZhtwFindingTabs(findings: ZhtwSidePanelFinding[], lang: Lang): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "zhtw-review-tabs-wrap";
  const grouped = new Map<ZhtwSidePanelFindingGroup, ZhtwSidePanelFinding[]>();
  for (const group of ZHTW_FINDING_TAB_ORDER) grouped.set(group, []);
  for (const finding of findings) grouped.get(finding.group)?.push(finding);
  const visibleGroups = ZHTW_FINDING_TAB_ORDER.filter((group) => (grouped.get(group)?.length ?? 0) > 0);
  const tabsId = `zhtw-tabs-${zhtwTabIdCounter += 1}`;

  if (visibleGroups.length > 1) {
    const tabList = document.createElement("div");
    tabList.className = "zhtw-review-tabs";
    tabList.setAttribute("role", "tablist");
    for (const [index, group] of visibleGroups.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zhtw-review-tab";
      button.id = `${tabsId}-${group}-tab`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.setAttribute("aria-controls", `${tabsId}-${group}-panel`);
      button.textContent = `${t(`sidepanel.dynamic.zhtw.tab.${ZHTW_FINDING_TAB_KEY[group]}`, lang)} ${grouped.get(group)?.length ?? 0}`;
      button.addEventListener("click", () => setActiveZhtwTab(wrap, group));
      tabList.appendChild(button);
    }
    wrap.appendChild(tabList);
  }

  for (const [index, group] of visibleGroups.entries()) {
    const groupFindings = grouped.get(group) ?? [];
    const panel = document.createElement("div");
    panel.className = "zhtw-review-tab-panel";
    if (groupFindings.length > ZHTW_FINDING_SCROLL_THRESHOLD) {
      panel.classList.add("zhtw-review-tab-panel-scroll");
    }
    panel.id = `${tabsId}-${group}-panel`;
    panel.dataset.zhtwGroup = group;
    panel.setAttribute("role", "tabpanel");
    if (visibleGroups.length > 1) {
      panel.setAttribute("aria-labelledby", `${tabsId}-${group}-tab`);
    }
    panel.hidden = index !== 0;
    panel.appendChild(renderZhtwFindingList(groupFindings));
    wrap.appendChild(panel);
  }

  return wrap;
}

function setActiveZhtwTab(wrap: HTMLElement, group: ZhtwSidePanelFindingGroup): void {
  for (const button of wrap.querySelectorAll<HTMLButtonElement>(".zhtw-review-tab")) {
    const isActive = button.id.includes(`-${group}-tab`);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const panel of wrap.querySelectorAll<HTMLElement>(".zhtw-review-tab-panel")) {
    panel.hidden = panel.dataset.zhtwGroup !== group;
  }
}

function renderZhtwFindingList(findings: ZhtwSidePanelFinding[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "zhtw-review-list";
  for (const finding of findings) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.className = "zhtw-review-issue-text";
    text.textContent = finding.text;
    item.appendChild(text);

    const meta = document.createElement("span");
    meta.className = `zhtw-review-meta zhtw-review-${finding.severity}`;
    const source = Array.from(new Set(finding.segmentLabels.filter((label) => label !== "貼文文字"))).join(" / ");
    const typeLabel = finding.group === "style"
      ? ""
      : Array.from(new Set(finding.ruleTypes.map(zhtwRuleTypeLabel))).join(" / ");
    const metaText = [typeLabel, source].filter(Boolean).join(" · ");
    if (metaText) {
      meta.textContent = ` · ${metaText}`;
      item.appendChild(meta);
    }
    list.appendChild(item);
  }
  return list;
}
