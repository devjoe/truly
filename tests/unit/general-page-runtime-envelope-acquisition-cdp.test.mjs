import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  acquisitionUrlsMatch,
  acquisitionUrlsFromCapturePacket,
  assertSelectionCaptureMatch,
  canContinueAfterSourceFailure,
  configureLowResourcePageTarget,
  emulateBackgroundPageVisibility,
  equivalentPageCaptureMetadata,
  FACEBOOK_MESSAGE_SELECTORS,
  hashAcquisitionText,
  isMetadataReportPath,
  PAGE_AUTO_READ_GRACE_MS,
  pageCaptureMatchesSource,
  pageSurfaceMatchesSourceTitle,
  publisherRedirectPending,
  selectFacebookMessageInDocument,
  shouldTriggerPageReread,
  validateAcquisitionUrls,
} from "../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs";

describe("General Page runtime-envelope no-focus acquisition", () => {
  it("accepts only credential-free HTTP(S) source URLs", () => {
    expect(validateAcquisitionUrls(["https://example.test/article"])).toEqual(["https://example.test/article"]);
    expect(() => validateAcquisitionUrls(["file:///private/page.html"])).toThrow(/unsafe acquisition URL/);
    expect(() => validateAcquisitionUrls(["https://user:secret@example.test/"])).toThrow(/unsafe acquisition URL/);
  });

  it("reuses only URLs from a private consumed capture packet", () => {
    expect(acquisitionUrlsFromCapturePacket({
      captures: [
        { analysis: { context: { canonicalUrl: "https://one.example.test/article", mainText: "private text" } } },
        { analysis: { context: { url: "https://two.example.test/page", mainText: "more private text" } } },
      ],
    })).toEqual([
      "https://one.example.test/article",
      "https://two.example.test/page",
    ]);
    expect(() => acquisitionUrlsFromCapturePacket({ captures: [] })).toThrow(/non-empty captures/);
    expect(acquisitionUrlsFromCapturePacket({
      captures: [
        { analysis: { context: { url: "https://one.example.test/" } } },
        { analysis: { context: { url: "https://two.example.test/" } } },
      ],
    }, 1)).toEqual(["https://two.example.test/"]);
  });

  it("matches the active source after removing only the private audit hash", () => {
    expect(acquisitionUrlsMatch(
      "https://example.test/article#truly-gpr-123",
      "https://example.test/article",
    )).toBe(true);
    expect(acquisitionUrlsMatch(
      "https://example.test/other",
      "https://example.test/article",
    )).toBe(false);
  });

  it("accepts the BBC RSS host redirect only when the article URL is otherwise exact", () => {
    expect(acquisitionUrlsMatch(
      "https://www.bbc.co.uk/news/articles/c74gwdzywmeo",
      "https://www.bbc.com/news/articles/c74gwdzywmeo",
    )).toBe(true);
    expect(acquisitionUrlsMatch(
      "https://www.bbc.co.uk/news/articles/c74gwdzywmeo",
      "https://www.bbc.com/news/articles/different",
    )).toBe(false);
    expect(acquisitionUrlsMatch(
      "https://www.bbc.co.uk/news/articles/c74gwdzywmeo",
      "https://www.bbc.example/news/articles/c74gwdzywmeo",
    )).toBe(false);
  });

  it("accepts a Page capture only from the expected tab and URL", () => {
    const metadata = {
      tabId: 42,
      contextUrl: "https://example.test/article#truly-gpr-123",
    };
    expect(pageCaptureMatchesSource(
      metadata,
      "https://example.test/article",
      42,
    )).toBe(true);
    expect(pageCaptureMatchesSource(
      metadata,
      "https://example.test/article",
      7,
    )).toBe(false);
    expect(pageCaptureMatchesSource(
      metadata,
      "https://other.example.test/article",
      42,
    )).toBe(false);
  });

  it("waits for Google News read links to leave the aggregator before reading", () => {
    const input = "https://news.google.com/read/example?hl=zh-TW";
    expect(publisherRedirectPending(
      input,
      "https://news.google.com/home?hl=zh-TW",
    )).toBe(true);
    expect(publisherRedirectPending(
      input,
      "https://publisher.example.test/article",
    )).toBe(false);
    expect(publisherRedirectPending(
      "https://news.google.com/home?hl=zh-TW",
      "https://news.google.com/home?hl=zh-TW",
    )).toBe(false);
    expect(publisherRedirectPending(
      "https://example.test/article",
      "https://example.test/article",
    )).toBe(false);
  });

  it("coalesces only identical duplicate Page capture metadata", () => {
    const base = {
      tabId: 42,
      scope: "page",
      targetKind: "general_web",
      extractionMethod: "semantic-html",
      extractionStatus: "complete",
      mainTextLength: 1200,
      mainTextHash: "1234abcd",
      contextUrl: "https://example.test/article#first",
      candidateCount: 12,
      candidateTextLength: 800,
    };
    expect(equivalentPageCaptureMetadata(base, {
      ...base,
      contextUrl: "https://example.test/article#second",
    })).toBe(true);
    expect(equivalentPageCaptureMetadata(base, {
      ...base,
      mainTextHash: "different",
    })).toBe(false);
  });

  it("recognizes a restored Page surface before explicitly re-reading it", () => {
    expect(pageSurfaceMatchesSourceTitle(
      "A useful article title",
      "A useful article title - Example News",
    )).toBe(true);
    expect(pageSurfaceMatchesSourceTitle(
      "A different article",
      "A useful article title - Example News",
    )).toBe(false);
    expect(pageSurfaceMatchesSourceTitle("", "A useful article title")).toBe(false);
  });

  it("gives Page auto-read a grace period before explicitly re-reading", () => {
    expect(shouldTriggerPageReread({
      elapsedMs: PAGE_AUTO_READ_GRACE_MS - 1,
      sawPageBusy: false,
      canReread: true,
      titleMatches: true,
    })).toBe(false);
    expect(shouldTriggerPageReread({
      elapsedMs: PAGE_AUTO_READ_GRACE_MS,
      sawPageBusy: false,
      canReread: true,
      titleMatches: true,
    })).toBe(true);
    expect(shouldTriggerPageReread({
      elapsedMs: PAGE_AUTO_READ_GRACE_MS,
      sawPageBusy: true,
      canReread: true,
      titleMatches: true,
    })).toBe(false);
  });

  it("continues only within the explicit per-batch source failure budget", () => {
    expect(canContinueAfterSourceFailure(0, 2)).toBe(true);
    expect(canContinueAfterSourceFailure(1, 2)).toBe(true);
    expect(canContinueAfterSourceFailure(2, 2)).toBe(false);
    expect(canContinueAfterSourceFailure(-1, 2)).toBe(false);
  });

  it("uses precise Facebook message-body selectors", () => {
    expect(FACEBOOK_MESSAGE_SELECTORS).toEqual([
      "[data-ad-rendering-role='story_message']",
      "[data-ad-preview='message']",
      "[data-ad-comet-preview='message']",
    ]);
  });

  it("selects Facebook authored text without trailing controls", () => {
    const dom = new JSDOM(`
      <div data-ad-rendering-role="story_message">
        <span>A sufficiently long synthetic Facebook post keeps authored words and an <a href="/topic">inline topic link</a> while avoiding interface text in the resulting range.</span>
        <span hidden>Hidden implementation text</span>
        <div role="button">See more and source controls</div>
      </div>
    `);
    const selection = dom.window.getSelection();

    const result = selectFacebookMessageInDocument(dom.window.document, selection);

    expect(result?.length).toBeGreaterThanOrEqual(80);
    expect(result?.text).toBe(selection?.toString());
    expect(selection?.toString()).toContain("inline topic link");
    expect(selection?.toString()).not.toContain("Hidden implementation text");
    expect(selection?.toString()).not.toContain("See more and source controls");
  });

  it("prefers story_message over a larger fallback wrapper", () => {
    const dom = new JSDOM(`
      <div data-ad-preview="message">
        <div data-ad-rendering-role="story_message">This synthetic post body is deliberately long enough to be selected without including the fallback wrapper controls or unrelated source labels.</div>
        <div role="button">Fallback wrapper control</div>
      </div>
    `);
    const selection = dom.window.getSelection();

    const result = selectFacebookMessageInDocument(dom.window.document, selection);

    expect(result).not.toBeNull();
    expect(selection?.toString()).not.toContain("Fallback wrapper control");
  });

  it("skips previously used and insufficient Facebook selections", () => {
    const dom = new JSDOM(`
      <div data-ad-rendering-role="story_message">This synthetic post body is deliberately long enough for stable duplicate detection during a resumed acquisition run.</div>
      <div data-ad-rendering-role="story_message">Too short</div>
    `);
    const selection = dom.window.getSelection();
    const first = selectFacebookMessageInDocument(dom.window.document, selection);

    expect(first).not.toBeNull();
    expect(selectFacebookMessageInDocument(
      dom.window.document,
      selection,
      FACEBOOK_MESSAGE_SELECTORS,
      [first.hash],
    )).toBeNull();
  });

  it("fails closed unless Focus capture matches the authorized selection", () => {
    const selection = { length: 120, hash: "1234abcd" };

    expect(() => assertSelectionCaptureMatch({
      mainTextHash: "1234abcd",
      selectedTextHash: "1234abcd",
    }, selection)).not.toThrow();
    expect(() => assertSelectionCaptureMatch({
      mainTextHash: "different",
      selectedTextHash: "1234abcd",
    }, selection)).toThrow(/does not match/);
    expect(() => assertSelectionCaptureMatch({
      mainTextHash: "1234abcd",
      selectedTextHash: null,
    }, selection)).toThrow(/lacks selection provenance/);
  });

  it("matches Focus captures by tab and exact Selection hash instead of arrival order", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("metadata?.tabId === expected.tabId");
    expect(source).toContain("metadata?.mainTextHash === expected.selection?.hash");
    expect(source).toContain("metadata?.selectedTextHash === expected.selection?.hash");
    expect(source).toContain("rejectedFocusCaptures");
  });

  it("records the capture baseline before opening a fast Page source", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const loop = source.indexOf("for (const url of inputUrls)");
    const baseline = source.indexOf("const before = await captureCount(worker, expectedScope)", loop);
    const open = source.indexOf("source = await openSource(worker", loop);
    expect(baseline).toBeGreaterThan(loop);
    expect(open).toBeGreaterThan(baseline);
  });

  it("activates the Facebook source before selecting message bodies", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const branch = source.indexOf('args.mode === "facebook-focus"');
    const activation = source.indexOf("activateTabWithoutWindowFocus(worker, source.tab.id)", branch);
    const documentReady = source.indexOf("waitForFacebookDocumentComplete(source.client", activation);
    const sideReload = source.indexOf("sideClient.reload()", activation);
    const acquisition = source.indexOf("acquireFacebookFocus", sideReload);
    expect(activation).toBeGreaterThan(branch);
    expect(documentReady).toBeGreaterThan(activation);
    expect(sideReload).toBeGreaterThan(documentReady);
    expect(sideReload).toBeGreaterThan(activation);
    expect(acquisition).toBeGreaterThan(sideReload);
  });

  it("stabilizes Focus before selecting Facebook text and consumes the hash only after capture", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const acquisition = source.indexOf("async function acquireFacebookFocus");
    const workspace = source.indexOf('selectWorkspace(sideClient, "focus")', acquisition);
    const selection = source.indexOf("selectFacebookMessage(source.client", workspace);
    const recheck = source.indexOf("facebookSelectionMatches(source.client", selection);
    const click = source.indexOf("clickFocusAction(sideClient", recheck);
    const capture = source.indexOf("waitForSingleCapture(worker", click);
    const consume = source.indexOf("used.add(selection.hash)", capture);
    expect(workspace).toBeGreaterThan(acquisition);
    expect(selection).toBeGreaterThan(workspace);
    expect(recheck).toBeGreaterThan(selection);
    expect(click).toBeGreaterThan(recheck);
    expect(capture).toBeGreaterThan(click);
    expect(consume).toBeGreaterThan(capture);
  });

  it("can advance a Facebook feed in the background before acquisition", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("advanceFacebookFeed(source.client, args.facebookStartScrolls)");
    expect(source).toContain('"--facebook-start-scrolls"');
    expect(source).toContain("window.scrollBy(0, Math.max(innerHeight * 0.9, 650))");
  });

  it("skips a settled Facebook brief that produced no investigation envelope", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("await facebookAnalysisSettled(expected.sideClient, expected.selectionText)");
    expect(source).toContain('document.querySelector(".page-reader-focus-fulltext")');
    expect(source).toContain('analysis?.classList.contains("is-ready")');
    expect(source).toContain("if (!capture)");
    expect(source).toContain("used.add(selection.hash)");
  });

  it("can reuse the active Facebook tab without owning or focusing it", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain('argv.includes("--facebook-existing-tab")');
    expect(source).toContain("openExistingFacebookSource");
    expect(source).toContain("if (!source.existing || !source.wasActive) await activateTabWithoutWindowFocus");
    expect(source).toContain("chrome.windows.getLastFocused");
    expect(source).toContain("source.previousActiveTabId");
    expect(source).toContain("window.getSelection()?.removeAllRanges()");
    expect(source).toContain("window.scrollTo(0,");
  });

  it("verifies that a workspace remains selected after asynchronous tab updates", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("workspace did not remain selected");
    expect(source).toContain("getAttribute('aria-selected') === 'true'");
  });

  it("keeps metadata reports under private temporary paths", () => {
    expect(isMetadataReportPath("tmp/runtime-envelope-report.json", "/workspace/truly")).toBe(true);
    expect(isMetadataReportPath("docs/runtime-envelope-report.json", "/workspace/truly")).toBe(false);
  });

  it("does not contain an API that requests browser-window focus", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).not.toContain("Page.bringToFront");
    expect(source).not.toContain("Target.activateTarget");
    expect(source).not.toContain("chrome.windows.update");
    expect(source).not.toMatch(/focused\s*:\s*true/);
  });

  it("emulates Facebook visibility without bringing the browser window forward", async () => {
    const calls = [];
    const client = {
      send: async (method, params) => {
        calls.push({ method, params });
      },
      evaluate: async (expression) => {
        calls.push({ method: "Runtime.evaluate", expression });
      },
    };

    await emulateBackgroundPageVisibility(client);

    expect(calls).toContainEqual({
      method: "Emulation.setFocusEmulationEnabled",
      params: { enabled: true },
    });
    expect(calls).toContainEqual({
      method: "Page.setWebLifecycleState",
      params: { state: "active" },
    });
    expect(calls.some((call) => call.method === "Page.bringToFront")).toBe(false);
    expect(
      calls.some((call) =>
        call.method === "Runtime.evaluate" &&
        call.expression.includes("window.focus")),
    ).toBe(false);
  });

  it("disables source-tab network cache to bound audit disk growth", async () => {
    const calls = [];
    const client = {
      send: async (method, params) => {
        calls.push({ method, params });
      },
    };

    await configureLowResourcePageTarget(client);

    expect(calls).toContainEqual({
      method: "Network.setCacheDisabled",
      params: { cacheDisabled: true },
    });
  });

  it("uses a dedicated inactive side panel instead of touching the user's panel", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("const side = await createInactiveTab(worker");
    expect(source).not.toContain("entry.url?.startsWith(sideUrl)");
    expect(source).not.toContain("if (!sideTarget)");
  });

  it("uniquely marks background source URLs and waits past about:blank", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("truly-gpr-${Date.now()}");
    expect(source).toContain("waitForHttpLocation");
    expect(source).toContain("/^https?:\\/\\//");
    expect(source).toContain("link[rel=\\\"canonical\\\"]");
    expect(source).toContain("source.matchUrl");
  });

  it("removes a source tab when opening it fails before ownership reaches the batch loop", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const open = source.indexOf("async function openSource");
    const cleanup = source.indexOf("await removeTab(worker, tab.id)", open);
    const rethrow = source.indexOf("throw error", cleanup);
    expect(open).toBeGreaterThan(0);
    expect(cleanup).toBeGreaterThan(open);
    expect(rethrow).toBeGreaterThan(cleanup);
  });

  it("does not require a Page investigation action before requesting a Focus target", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const focusSelection = source.indexOf('stage = "select-focus-text"');
    const focusWorkspace = source.indexOf('stage = "select-workspace"', focusSelection);
    const focusAction = source.indexOf("clickFocusAction", focusWorkspace);
    expect(source).not.toContain('stage = "wait-page-prewarm"');
    expect(focusSelection).toBeGreaterThan(0);
    expect(focusWorkspace).toBeGreaterThan(focusSelection);
    expect(focusAction).toBeGreaterThan(focusWorkspace);
  });

  it("clears late pre-cohort captures and rejects captures from another URL", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("await clearCaptureBuffer(worker)");
    expect(source).toContain("acquisitionUrlsMatch(metadata?.contextUrl, expectedUrl)");
    expect(source).toContain("await removeScopeCaptures(worker");
    expect(source).toContain("equivalentPageCaptureMetadata(first.metadata, metadata)");
    expect(source).toContain("divergent duplicate captures");
    expect(source).toContain("removeCapturesForTab(worker, source.tab.id)");
    expect(source).toContain("sourceFailures");
    expect(source).toContain("waitForPageAutoReadOrReread(");
    expect(source).toContain("pageSurfaceMatchesSourceTitle(surface.title, expectedTitle)");
    expect(source).toContain("sawPageBusy");
    expect(source).toContain("if (surface.isBusy) sawPageBusy = true");
    expect(source).toContain("shouldTriggerPageReread({");
    expect(source).toContain("Date.now() - startedAt");
    expect(source).toContain("#pageReadCurrent");
  });

  it("requires an explicit resume flag before accepting a non-empty armed buffer", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source).toContain("requireEmpty: !args.resume");
    expect(source).toContain('argv.includes("--resume")');
  });

  it("normalizes Facebook selection text before hashing across resumed runs", () => {
    expect(hashAcquisitionText("  same\n Facebook   post ")).toBe(hashAcquisitionText("same Facebook post"));
    expect(hashAcquisitionText("different Facebook post")).not.toBe(hashAcquisitionText("same Facebook post"));
  });

  it("seeds Facebook deduplication from hashes already buffered by the collector", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const branch = source.indexOf('args.mode === "facebook-focus"');
    const existingHashes = source.indexOf('captureTextHashes(worker, "focus")', branch);
    const acquisition = source.indexOf("acquireFacebookFocus", existingHashes);
    expect(existingHashes).toBeGreaterThan(branch);
    expect(acquisition).toBeGreaterThan(existingHashes);
    expect(source.slice(existingHashes, acquisition + 200)).toContain("initialUsedHashes");
  });

  it("resets the collector handshake before every fresh or resumed acquisition", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    const arm = source.indexOf("waitForCaptureArm(worker");
    const reset = source.indexOf("resetCaptureConsumerHandshake(worker)", arm);
    const sidePanel = source.indexOf("const sideUrl", reset);
    expect(reset).toBeGreaterThan(arm);
    expect(sidePanel).toBeGreaterThan(reset);
  });

  it("fingerprints the actual Selection API text instead of DOM textContent", () => {
    const source = fs.readFileSync(new URL("../../scripts/acquire-general-page-runtime-envelopes-cdp.mjs", import.meta.url), "utf8");
    expect(source.match(/const selectedText = clean\(selection\.toString\(\)\)/g)).toHaveLength(2);
    expect(source).toContain("return { length: selectedText.length, hash: valueHash, text: selectedText }");
    expect(source).toContain("return { length: selectedText.length, hash: hash(selectedText) }");
  });
});
