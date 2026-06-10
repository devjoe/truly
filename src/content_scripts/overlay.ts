import type {
  ClassificationScores,
  FilterDecision,
  Lang,
  PostData,
  ThemeMode,
} from "../lib/types";
import { ALL_CATEGORIES } from "../lib/types";
import { t } from "../lib/i18n";
import { addToAllowlist } from "../lib/filter-engine";
import { defaultModelForProvider } from "../lib/model-source-config";
import {
  clearHeadsUpPanel,
  ensureHeadsUpPlaceholder,
  hasHeadsUpPanel,
  renderHeadsUpPanel,
  setHeadsUpThemeMode as setPanelHeadsUpThemeMode,
  setOllamaModel as setHeadsUpOllamaModel,
  syncAllHeadsUpHostThemes,
} from "./heads-up-panel";

type SponsoredDisplayMode = "none" | "collapse" | "blur";

let sponsoredDisplayMode: SponsoredDisplayMode = "collapse";
let cachedOllamaModel: string = defaultModelForProvider("ollama", "reading-prompt");
let currentLang: Lang = "zh-TW";
const AUTO_FOLD_EXPANDED_ATTR = "trulyAutoFoldExpanded";

export function setSponsoredDisplayMode(mode: SponsoredDisplayMode): void {
  sponsoredDisplayMode = mode;
}

export function setOllamaModel(model: string): void {
  cachedOllamaModel = model;
  setHeadsUpOllamaModel(model);
}

export function setHeadsUpThemeMode(mode: ThemeMode): void {
  setPanelHeadsUpThemeMode(mode);
}

export function syncHeadsUpThemes(): void {
  syncAllHeadsUpHostThemes();
}

export function reserveHeadsUpSlot(post: PostData, lang: Lang = currentLang): void {
  if (post.element.dataset.trulySponsored === "true") return;
  currentLang = lang;
  trackedArticles.add(post.element);
  latestPostByArticle.set(post.element, post);
  ensureHeadsUpPlaceholder(post.element, lang);
}

export function clearHeadsUpSurface(post: PostData): void {
  clearHeadsUpPanel(post.element);
}

export function clearAllHeadsUpSurfaces(): void {
  for (const article of document.querySelectorAll<HTMLElement>("[data-truly-id]")) {
    clearHeadsUpPanel(article);
  }
}

export function syncLocalizedContentSurfaces(lang: Lang): void {
  currentLang = lang;
  for (const article of Array.from(trackedArticles)) {
    if (!document.contains(article)) {
      trackedArticles.delete(article);
      continue;
    }
    if (article.querySelector(".truly-collapse-bar")) continue;

    const decision = latestDecisionByArticle.get(article);
    const post = latestPostByArticle.get(article);
    if (decision && post) {
      renderHeadsUpPanel(article, post, decision, { lang, force: true });
      continue;
    }

    if (article.querySelector(".truly-headsup-host")) {
      ensureHeadsUpPlaceholder(article, lang);
    }
  }
}

function displayModelName(raw: string): string {
  return raw.replace(/:latest$/, "");
}

function scoreBand(score: number): "low" | "mid" | "high" {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "mid";
  return "low";
}

/**
 * FB's React reconciles the post subtree on its own schedule (engagement
 * counts ticking up, lazy-loaded media swapping in, GraphQL upgrades,
 * etc.). Any of those can wipe the .truly-headsup we inserted as
 * `firstChild`. For posts that won't get a follow-up applyOverlay (text
 * length ≤ Tier 3 gate, no GraphQL upgrade), there's no second chance to
 * re-mount → the user sees no panel at all.
 *
 * Watch the article for ~6s after each successful render; if the panel
 * disappears (and the article hasn't been collapsed in the meantime),
 * re-render. WeakMap-tracked so a per-element observer is reused across
 * multiple applyOverlay calls (we update its captured decision via the
 * map; the actual MutationObserver only registers once per element).
 *
 * 6s covers the typical render-storm window after a post mounts. Past
 * that, the panel state is stable enough that we can stop watching.
 */
const guardObservers = new WeakMap<HTMLElement, { stop: () => void }>();
const GUARD_WINDOW_MS = 6000;
const latestDecisionByArticle = new WeakMap<HTMLElement, FilterDecision>();
const latestPostByArticle = new WeakMap<HTMLElement, PostData>();
const trackedArticles = new Set<HTMLElement>();

function guardHeadsUpPanel(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision
): void {
  // Update-or-replace: if a guard is already running, restart it with
  // the latest decision so progressive Tier 1 → Tier 3 upgrades don't
  // cause a stale guard to rewrite a fresher panel.
  const existing = guardObservers.get(article);
  if (existing) existing.stop();

  const observer = new MutationObserver(() => {
    if (article.querySelector(".truly-collapse-bar")) return;
    if (hasHeadsUpPanel(article)) return;
    // Panel was removed by a React reconcile. Re-mount immediately.
    renderHeadsUpPanel(article, post, decision, { lang: currentLang });
  });
  observer.observe(article, { childList: true, subtree: false });

  const timer = window.setTimeout(() => {
    observer.disconnect();
    guardObservers.delete(article);
  }, GUARD_WINDOW_MS);

  guardObservers.set(article, {
    stop: () => {
      observer.disconnect();
      window.clearTimeout(timer);
    },
  });
}

export function applyOverlay(
  post: PostData,
  decision: FilterDecision,
  options?: { forceBlur?: boolean; lang?: Lang }
): void {
  const lang = options?.lang ?? currentLang;
  currentLang = lang;
  const article = post.element;
  latestDecisionByArticle.set(article, decision);
  latestPostByArticle.set(article, post);
  trackedArticles.add(article);

  // If the post is currently collapsed (user chose "縮小"), preserve that
  // state — don't re-render the heads-up panel on progressive updates. The
  // latest decision is still retained above so expand can hydrate current
  // Tier B status instead of the stale collapse-button closure state.
  if (article.querySelector(".truly-collapse-bar")) return;

  // Remove any existing blur overlay and report pill group (we'll re-add if filtered)
  const existing = article.querySelector(".truly-overlay");
  if (existing) existing.remove();
  const existingPillGroup = article.querySelector(".truly-report-pill-group");
  if (existingPillGroup) existingPillGroup.remove();

  // Non-sponsored auto-fold: when the engine flagged a foldReason and the
  // user has the collapse display mode, treat the post as collapse-eligible
  // (built-in axis above threshold or custom rule fired). Sponsored posts
  // keep their existing path below.
  if (
    !decision.filtered &&
    decision.foldReason &&
    sponsoredDisplayMode === "collapse" &&
    article.dataset[AUTO_FOLD_EXPANDED_ATTR] !== "true"
  ) {
    article.style.position = article.style.position || "relative";
    clearHeadsUpPanel(article);
    collapseAutoFolded(article, post, decision, lang);
    return;
  }

  if (!decision.filtered) {
    // Mount or upgrade the heads-up panel — single surface above the post
    // body that carries severity dot + signal chips + collapsible details.
    renderHeadsUpPanel(article, post, decision, { lang });
    guardHeadsUpPanel(article, post, decision);
    return;
  }

  // Sanity check: don't apply overlay to oversized containers (likely wrong target)
  const rect = article.getBoundingClientRect();
  if (rect.width > 800 || rect.height > 1800) {
    console.warn(
      `[Truly] Skipping overlay on oversized container: ${Math.round(rect.width)}x${Math.round(rect.height)} (id=${article.dataset.trulyId})`
    );
    return;
  }

  article.style.position = "relative";

  if (sponsoredDisplayMode === "none" && !options?.forceBlur) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "truly-overlay";

  const reason = document.createElement("div");
  reason.className = "truly-overlay-reason";
  reason.textContent = `${decision.reason || "Low quality content"} `;

  const tierBadge = document.createElement("span");
  tierBadge.className = "truly-tier-badge";
  tierBadge.textContent = decision.tier === 3 ? `LLM:${displayModelName(cachedOllamaModel)}` : "H";
  reason.appendChild(tierBadge);

  const actions = document.createElement("div");
  actions.className = "truly-overlay-actions";

  const showBtn = document.createElement("button");
  showBtn.className = "truly-btn truly-btn-primary";
  showBtn.textContent = t("content.overlay.show", lang);
  showBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.classList.remove("truly-visible");
    setTimeout(() => {
      overlay.remove();
      attachReportPill(article, post, decision, lang);
    }, 200);
  });

  const allowBtn = document.createElement("button");
  allowBtn.className = "truly-btn";
  allowBtn.textContent = t("content.overlay.alwaysShow", lang);
  allowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (post.authorName) {
      addToAllowlist(post.authorName);
    }
    overlay.classList.remove("truly-visible");
    setTimeout(() => overlay.remove(), 200);
  });

  const reportBtn = document.createElement("button");
  reportBtn.className = "truly-btn";
  reportBtn.textContent = t("content.overlay.notHidden", lang);
  reportBtn.title = t("content.overlay.notHiddenTitle", lang);
  reportBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    reportBtn.disabled = true;
    reportBtn.textContent = t("content.overlay.shown", lang);
    overlay.classList.remove("truly-visible");
    setTimeout(() => overlay.remove(), 200);
  });

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "truly-btn";
  collapseBtn.textContent = t("content.overlay.collapse", lang);
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapseSponsored(article, post, decision, lang);
  });

  actions.appendChild(showBtn);
  actions.appendChild(collapseBtn);
  if (post.authorName) {
    actions.appendChild(allowBtn);
  }
  actions.appendChild(reportBtn);

  overlay.appendChild(reason);

  // Show LLM score chips on the overlay when available
  const scores = decision.scores || {};
  if (Object.keys(scores).length > 0) {
    const scoreRow = document.createElement("div");
    scoreRow.className = "truly-overlay-scores";
    for (const cat of ALL_CATEGORIES) {
      const score = (scores as ClassificationScores)[cat] ?? 0;
      if (score < 0.01) continue;
      const chip = document.createElement("span");
      chip.className = `truly-score-chip truly-score-chip-${scoreBand(score)}`;
      chip.textContent = `${cat} ${score.toFixed(2)}`;
      scoreRow.appendChild(chip);
    }
    if (scoreRow.children.length > 0) {
      overlay.appendChild(scoreRow);
    }
  }

  overlay.appendChild(actions);
  article.appendChild(overlay);

  // Default display mode for sponsored posts. `forceBlur` bypasses this
  // so that expandSponsored() can re-render a blur overlay without
  // immediately re-collapsing the post.
  if (sponsoredDisplayMode === "collapse" && !options?.forceBlur) {
    collapseSponsored(article, post, decision, lang);
    return;
  }

  // Trigger transition
  requestAnimationFrame(() => {
    overlay.classList.add("truly-visible");
  });
}

function attachReportPill(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  lang: Lang
): void {
  // Avoid duplicates
  const existing = article.querySelector(".truly-report-pill");
  if (existing) return;

  article.style.position = article.style.position || "relative";

  const wrapper = document.createElement("div");
  wrapper.className = "truly-report-pill-group";

  const pill = document.createElement("button");
  pill.className = "truly-report-pill truly-report-pill-in-group";
  pill.title = t("content.overlay.notHiddenReason", lang, { reason: decision.reason || "?" });
  pill.textContent = t("content.overlay.notHidden", lang);
  pill.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    pill.disabled = true;
    pill.textContent = t("content.overlay.shown", lang);
    setTimeout(() => pill.remove(), 1200);
  });

  const rehideBtn = document.createElement("button");
  rehideBtn.className = "truly-report-pill truly-report-pill-in-group";
  rehideBtn.textContent = t("content.overlay.recollapse", lang);
  rehideBtn.title = t("content.overlay.recollapseTitle", lang);
  rehideBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    wrapper.remove();
    collapseSponsored(article, post, decision, lang);
  });

  wrapper.appendChild(pill);
  wrapper.appendChild(rehideBtn);
  article.appendChild(wrapper);
}

// --- Collapse mode: shrink sponsored post to just author name ---

function collapseSponsored(
  article: HTMLElement,
  post: PostData,
  _decision: FilterDecision,
  lang: Lang
): void {
  // Save original content height so we can restore later
  const originalHeight = article.scrollHeight;
  article.dataset.trulyOriginalHeight = String(originalHeight);

  // Hide all direct children except the collapse bar
  for (const child of Array.from(article.children)) {
    if (child.classList.contains("truly-collapse-bar")) continue;
    (child as HTMLElement).style.display = "none";
  }

  // Remove existing overlay — we're replacing it with the collapse bar
  const overlay = article.querySelector(".truly-overlay");
  if (overlay) overlay.remove();
  // Suppress the heads-up panel — the collapse bar conveys the signal.
  clearHeadsUpPanel(article);

  const bar = document.createElement("div");
  bar.className = "truly-collapse-bar";

  const label = document.createElement("span");
  label.className = "truly-collapse-label";
  const authorDisplay = post.authorName || t("content.overlay.unknownSource", lang);
  label.textContent = t("content.overlay.sponsored", lang, { source: authorDisplay });
  bar.appendChild(label);

  // Sponsored fold uses `decision.reason` (kept for backwards-compat) —
  // rendered as a muted reason chip when present.
  if (_decision.reason && _decision.reason !== "贊助文") {
    const reasonEl = document.createElement("span");
    reasonEl.className = "truly-collapse-bar-reason";
    reasonEl.textContent = _decision.reason;
    bar.appendChild(reasonEl);
  }

  const expandBtn = document.createElement("button");
  expandBtn.className = "truly-btn truly-btn-primary";
  expandBtn.textContent = t("content.overlay.expand", lang);
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    expandSponsored(article, post, _decision, lang);
  });

  bar.appendChild(expandBtn);
  article.appendChild(bar);
}

/** Collapse a non-sponsored post that the engine flagged via foldReason
 *  (built-in axis above threshold or custom rule fired). Renders the
 *  same `.truly-collapse-bar` UI as the sponsored path but with a different
 *  prefix label and the foldReason. */
function collapseAutoFolded(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  lang: Lang,
): void {
  delete article.dataset[AUTO_FOLD_EXPANDED_ATTR];
  const originalHeight = article.scrollHeight;
  article.dataset.trulyOriginalHeight = String(originalHeight);

  for (const child of Array.from(article.children)) {
    if (child.classList.contains("truly-collapse-bar")) continue;
    (child as HTMLElement).style.display = "none";
  }
  const overlay = article.querySelector(".truly-overlay");
  if (overlay) overlay.remove();
  clearHeadsUpPanel(article);

  const bar = document.createElement("div");
  bar.className = "truly-collapse-bar truly-collapse-bar-auto";

  const label = document.createElement("span");
  label.className = "truly-collapse-label";
  const authorDisplay = post.authorName || t("content.overlay.unknownSource", lang);
  label.textContent = authorDisplay;
  bar.appendChild(label);

  if (decision.foldReason) {
    const reasonEl = document.createElement("span");
    reasonEl.className = "truly-collapse-bar-reason";
    reasonEl.textContent = decision.foldReason;
    bar.appendChild(reasonEl);
  }

  const expandBtn = document.createElement("button");
  expandBtn.className = "truly-btn truly-btn-primary";
  expandBtn.textContent = t("content.overlay.expand", lang);
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    expandAutoFolded(article, post, decision, lang);
  });

  bar.appendChild(expandBtn);
  article.appendChild(bar);
}

/** Restore a non-sponsored auto-folded post to its expanded state. */
function expandAutoFolded(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  lang: Lang,
): void {
  article.dataset[AUTO_FOLD_EXPANDED_ATTR] = "true";
  const latestDecision = latestDecisionByArticle.get(article) ?? decision;
  const bar = article.querySelector(".truly-collapse-bar");
  if (bar) bar.remove();
  for (const child of Array.from(article.children)) {
    (child as HTMLElement).style.display = "";
  }
  // Re-render the heads-up panel so the user can still drill in.
  renderHeadsUpPanel(article, post, latestDecision, { lang });
}

function expandSponsored(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  lang: Lang,
): void {
  const latestDecision = latestDecisionByArticle.get(article) ?? decision;
  const bar = article.querySelector(".truly-collapse-bar");
  if (bar) bar.remove();

  // Restore all hidden children — show the full post directly,
  // NO blur overlay. The user explicitly requested that expanding
  // a sponsored post reveals it immediately without an intermediate
  // blurred state.
  for (const child of Array.from(article.children)) {
    (child as HTMLElement).style.display = "";
  }

  renderHeadsUpPanel(article, post, latestDecision, { lang });
  attachReportPill(article, post, latestDecision, lang);
}
