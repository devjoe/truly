// Shared helpers for prompting + checking the optional host permission
// that a configured inference endpoint outside localhost needs in MV3. Used
// by both the options page (Ollama path) and the sidepanel Tier B
// section (Tier B path).
//
// Permission requests REQUIRE a user gesture — call these only from
// within an event handler the user triggered (button click, toggle
// change). Calling from a passive context (page load, runtime message
// handler) returns false silently.

export function isLocalhostEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Returns true if the origin is already granted, OR was just granted
 *  by the user. Returns false on user denial, malformed URL, or
 *  missing-user-gesture errors. Localhost is auto-true (always covered
 *  by static `host_permissions`). */
export async function requestEndpointPermission(url: string): Promise<boolean> {
  if (isLocalhostEndpoint(url)) return true;
  try {
    const origin = new URL(url).origin + "/*";
    // Fast-path: already granted from a previous session.
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    console.warn("[Truly] endpoint permission request failed:", e);
    return false;
  }
}
