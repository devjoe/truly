// Shared browser-side labeling client for the general-page product-quality
// review report. It is injected into the generated review.html so a human
// reviewer can label cards in place, persist labels to localStorage, and
// export a manual-labels.jsonl file without hand-editing JSONL.
//
// This module is public/dev tooling only. It ships no real page data; all
// review content lives in the generated (gitignored) tmp/ report.

export const LABELING_MARKER = "truly-review-labeling-client";

// The client is written as a plain string so it can be embedded verbatim into
// the static HTML report. It queries the DOM at runtime, so it is resilient to
// minor markup changes in the card template.
export function labelingClientScript() {
  return `<script data-truly="${LABELING_MARKER}">
(function () {
  var STORE_KEY = "truly-review-labels";
  var VERDICTS = ["unreviewed", "good", "usable_with_caution", "partial", "bad", "blocked_or_empty_ok"];

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  var store = loadStore();
  // If nothing has been labeled yet in this browser, adopt a pre-filled seed
  // (e.g. an automated first-pass) so the reviewer can override rather than
  // start from scratch. Never clobbers existing manual work.
  if (Object.keys(store).length === 0 && window.__TRULY_LABEL_SEED__ && typeof window.__TRULY_LABEL_SEED__ === "object") {
    store = window.__TRULY_LABEL_SEED__;
    saveStore(store);
  }
  var articles = Array.prototype.slice.call(document.querySelectorAll("article[id]"));
  var rows = articles.map(function (article) {
    return {
      id: article.id,
      url: (article.querySelector("a") || {}).href || "",
      article: article,
      select: article.querySelector(".review select"),
      input: article.querySelector(".review input"),
      textarea: article.querySelector(".review textarea"),
    };
  });

  function readRow(row) {
    var tags = (row.input ? row.input.value : "")
      .split(",")
      .map(function (t) { return t.trim(); })
      .filter(Boolean);
    return {
      targetId: row.id,
      url: row.url,
      verdict: row.select ? row.select.value : "unreviewed",
      issueTags: tags,
      notes: row.textarea ? row.textarea.value : "",
    };
  }

  function persist(row) {
    var rec = readRow(row);
    store[row.id] = { verdict: rec.verdict, issueTags: rec.issueTags, notes: rec.notes, url: rec.url };
    saveStore(store);
    markRow(row);
    updateProgress();
  }

  function markRow(row) {
    var reviewed = row.select && row.select.value !== "unreviewed";
    row.article.style.borderLeft = reviewed ? "4px solid #2fd184" : "";
  }

  // Restore any previously saved labels and wire change listeners.
  rows.forEach(function (row) {
    var rec = store[row.id];
    if (rec) {
      if (rec.verdict && row.select) row.select.value = rec.verdict;
      if (row.input) {
        if (Array.isArray(rec.issueTags)) row.input.value = rec.issueTags.join(", ");
        else if (typeof rec.issueTags === "string") row.input.value = rec.issueTags;
      }
      if (rec.notes && row.textarea) row.textarea.value = rec.notes;
    }
    if (row.select) row.select.addEventListener("change", function () { persist(row); });
    if (row.input) row.input.addEventListener("input", function () { persist(row); });
    if (row.textarea) row.textarea.addEventListener("input", function () { persist(row); });
    markRow(row);
  });

  function reviewedCount() {
    return rows.filter(function (r) { return r.select && r.select.value !== "unreviewed"; }).length;
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "application/x-ndjson" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJsonl(onlyReviewed) {
    var lines = rows
      .filter(function (r) { return !onlyReviewed || (r.select && r.select.value !== "unreviewed"); })
      .map(function (r) { return JSON.stringify(readRow(r)); });
    download("manual-labels.jsonl", lines.join("\\n") + "\\n");
  }

  // Floating toolbar.
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9;display:flex;gap:8px;align-items:center;padding:10px 14px;background:#181818;border:1px solid #3d3d3d;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#eee;";
  var counter = document.createElement("span");
  counter.style.cssText = "min-width:96px;color:#c9c9c9;";
  function updateProgress() {
    counter.textContent = "Labeled " + reviewedCount() + " / " + rows.length;
  }
  function makeBtn(label, handler) {
    var b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "background:#202020;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px;";
    b.addEventListener("click", handler);
    return b;
  }
  bar.appendChild(counter);
  bar.appendChild(makeBtn("Export all", function () { exportJsonl(false); }));
  bar.appendChild(makeBtn("Export reviewed", function () { exportJsonl(true); }));
  bar.appendChild(makeBtn("Clear", function () {
    if (!window.confirm("Clear all labels saved in this browser?")) return;
    store = {};
    saveStore(store);
    rows.forEach(function (r) {
      if (r.select) r.select.value = "unreviewed";
      if (r.textarea) r.textarea.value = "";
      markRow(r);
    });
    updateProgress();
  }));
  document.body.appendChild(bar);
  updateProgress();
})();
</script>`;
}
