import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  acquisitionUrlsMatch,
  acquisitionUrlsFromCapturePacket,
  assertSelectionCaptureMatch,
  FACEBOOK_MESSAGE_SELECTORS,
  hashAcquisitionText,
  isMetadataReportPath,
  pageSurfaceMatchesSourceTitle,
  selectFacebookMessageInDocument,
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
    expect(source).toContain("waitForPageAutoReadOrReread(");
    expect(source).toContain("pageSurfaceMatchesSourceTitle(surface.title, expectedTitle)");
    expect(source).toContain("sawPageBusy");
    expect(source).toContain("if (surface.isBusy) sawPageBusy = true");
    expect(source).toContain("if (!sawPageBusy && surface.canReread && titleMatches)");
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
    expect(source).toContain("return { length: selectedText.length, hash: valueHash }");
    expect(source).toContain("return { length: selectedText.length, hash: hash(selectedText) }");
  });
});
