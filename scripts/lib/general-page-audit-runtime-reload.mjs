const FACEBOOK_PAGE_RE = /^https?:\/\/([^/]+\.)?facebook\.com(?:[/:]|$)/i;

export function isFacebookPageTarget(target) {
  return target?.type === "page" &&
    typeof target.url === "string" &&
    FACEBOOK_PAGE_RE.test(target.url) &&
    typeof target.webSocketDebuggerUrl === "string";
}

export async function reloadStaleExtensionWithFacebookRecovery({
  autoReload,
  expectedBuildId,
  liveBuildId,
  targets,
  reloadExtension,
  reloadFacebookTarget,
  settleAfterFacebookReload = async () => {},
}) {
  const facebookTargets = (targets || []).filter(isFacebookPageTarget);
  const staleFacebookTargets = facebookTargets.filter((target) =>
    target.contentScriptBuildId !== expectedBuildId);
  const extensionStale = liveBuildId !== expectedBuildId;
  const report = {
    requested: Boolean(autoReload),
    extensionStale,
    extensionReloaded: false,
    skippedReason: null,
    facebookTabsFound: facebookTargets.length,
    facebookTabsStale: staleFacebookTargets.length,
    facebookTabsReloaded: 0,
  };

  if (!autoReload) {
    report.skippedReason = "not_requested";
    return report;
  }

  if (!extensionStale && staleFacebookTargets.length === 0) {
    report.skippedReason = "already_fresh";
    return report;
  }

  if (extensionStale) {
    await reloadExtension();
    report.extensionReloaded = true;
  }

  // Reloading the extension invalidates every content-script context in an
  // existing Facebook document, even when that tab previously matched the
  // expected build. Without an extension reload, recover only the tabs whose
  // DOM build stamp proves their content script is stale or absent.
  const recoveryTargets = extensionStale ? facebookTargets : staleFacebookTargets;
  for (const target of recoveryTargets) {
    await reloadFacebookTarget(target);
    report.facebookTabsReloaded += 1;
  }
  if (recoveryTargets.length > 0) await settleAfterFacebookReload();

  return report;
}
