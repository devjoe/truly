import { describe, expect, it, vi } from "vitest";

import { resolveClaimPreparationEvidence } from "../../scripts/lib/general-page-audit-claim-transition.mjs";
import { reloadStaleExtensionWithFacebookRecovery } from "../../scripts/lib/general-page-audit-runtime-reload.mjs";

describe("General Page audit claim preparation transition", () => {
  it("accepts a safely observed live preparing state", () => {
    expect(resolveClaimPreparationEvidence({
      observed: true,
      text: "Preparing",
      originalClaimVisible: true,
      readyCardVisible: false,
    }, [])).toEqual({
      observed: true,
      text: "Preparing",
      originalClaimVisible: true,
      readyCardVisible: false,
      source: "live",
    });
  });

  it("recovers a safe fast transition from the mutation timeline", () => {
    expect(resolveClaimPreparationEvidence({
      observed: false,
      text: "",
      originalClaimVisible: false,
      readyCardVisible: true,
    }, [{
      claimPreparingPresent: true,
      claimPreparingText: "Preparing",
      claimOriginalVisible: true,
      claimReadyCardVisible: false,
    }])).toEqual({
      observed: true,
      text: "Preparing",
      originalClaimVisible: true,
      readyCardVisible: false,
      source: "timeline",
    });
  });

  it("rejects timeline evidence that overlaps the ready card", () => {
    expect(resolveClaimPreparationEvidence({ observed: false }, [{
      claimPreparingPresent: true,
      claimPreparingText: "Preparing",
      claimOriginalVisible: true,
      claimReadyCardVisible: true,
    }])).toMatchObject({
      observed: false,
      source: "none",
    });
  });
});

describe("General Page audit runtime reload", () => {
  it("does not reload an extension that already matches the expected build", async () => {
    const reloadExtension = vi.fn();
    const reloadFacebookTarget = vi.fn();

    const result = await reloadStaleExtensionWithFacebookRecovery({
      autoReload: true,
      expectedBuildId: "build-current",
      liveBuildId: "build-current",
      targets: [facebookTarget("facebook-1", "https://www.facebook.com/", "build-current")],
      reloadExtension,
      reloadFacebookTarget,
    });

    expect(result).toEqual({
      requested: true,
      extensionStale: false,
      extensionReloaded: false,
      skippedReason: "already_fresh",
      facebookTabsFound: 1,
      facebookTabsStale: 0,
      facebookTabsReloaded: 0,
    });
    expect(reloadExtension).not.toHaveBeenCalled();
    expect(reloadFacebookTarget).not.toHaveBeenCalled();
  });

  it("reloads existing Facebook tabs after reloading a stale extension", async () => {
    const events = [];
    const facebookOne = facebookTarget("facebook-1");
    const facebookTwo = facebookTarget("facebook-2", "https://m.facebook.com/");
    const reloadExtension = vi.fn(async () => {
      events.push("extension");
    });
    const reloadFacebookTarget = vi.fn(async (target) => {
      events.push(`facebook:${target.id}`);
    });
    const settleAfterFacebookReload = vi.fn(async () => {
      events.push("settle");
    });

    const result = await reloadStaleExtensionWithFacebookRecovery({
      autoReload: true,
      expectedBuildId: "build-current",
      liveBuildId: "build-stale",
      targets: [
        facebookOne,
        { id: "news-1", type: "page", url: "https://example.test/", webSocketDebuggerUrl: "ws://news-1" },
        facebookTwo,
      ],
      reloadExtension,
      reloadFacebookTarget,
      settleAfterFacebookReload,
    });

    expect(events).toEqual([
      "extension",
      "facebook:facebook-1",
      "facebook:facebook-2",
      "settle",
    ]);
    expect(result).toEqual({
      requested: true,
      extensionStale: true,
      extensionReloaded: true,
      skippedReason: null,
      facebookTabsFound: 2,
      facebookTabsStale: 2,
      facebookTabsReloaded: 2,
    });
  });

  it("recovers only stale Facebook content scripts when the extension is already fresh", async () => {
    const reloadExtension = vi.fn();
    const reloadFacebookTarget = vi.fn();
    const settleAfterFacebookReload = vi.fn();
    const staleFacebook = facebookTarget("facebook-stale", "https://www.facebook.com/", "build-stale");
    const freshFacebook = facebookTarget("facebook-fresh", "https://m.facebook.com/", "build-current");

    const result = await reloadStaleExtensionWithFacebookRecovery({
      autoReload: true,
      expectedBuildId: "build-current",
      liveBuildId: "build-current",
      targets: [staleFacebook, freshFacebook],
      reloadExtension,
      reloadFacebookTarget,
      settleAfterFacebookReload,
    });

    expect(reloadExtension).not.toHaveBeenCalled();
    expect(reloadFacebookTarget).toHaveBeenCalledTimes(1);
    expect(reloadFacebookTarget).toHaveBeenCalledWith(staleFacebook);
    expect(settleAfterFacebookReload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      requested: true,
      extensionStale: false,
      extensionReloaded: false,
      skippedReason: null,
      facebookTabsFound: 2,
      facebookTabsStale: 1,
      facebookTabsReloaded: 1,
    });
  });
});

function facebookTarget(id, url = "https://www.facebook.com/", contentScriptBuildId = "build-stale") {
  return {
    id,
    type: "page",
    url,
    webSocketDebuggerUrl: `ws://${id}`,
    contentScriptBuildId,
  };
}
