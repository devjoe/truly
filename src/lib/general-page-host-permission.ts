export const GENERAL_PAGE_ALL_HOST_ORIGINS = ["http://*/*", "https://*/*"] as const;

export type GeneralPageHostAccessStatus = "all_sites" | "active_tab_only" | "unavailable";

type PermissionsApi = {
  contains: (permissions: chrome.permissions.Permissions) => Promise<boolean>;
  request: (permissions: chrome.permissions.Permissions) => Promise<boolean>;
  remove: (permissions: chrome.permissions.Permissions) => Promise<boolean>;
};

function permissionsApi(): PermissionsApi | undefined {
  const api = (globalThis as typeof globalThis & {
    chrome?: { permissions?: Partial<PermissionsApi> };
  }).chrome?.permissions;
  if (!api?.contains || !api.request || !api.remove) return undefined;
  return api as PermissionsApi;
}

function allHostsPermission(): chrome.permissions.Permissions {
  return { origins: [...GENERAL_PAGE_ALL_HOST_ORIGINS] };
}

export function generalPageOriginPermissionForUrl(rawUrl: string): chrome.permissions.Permissions | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { origins: [`${url.protocol}//${url.host}/*`] };
  } catch {
    return undefined;
  }
}

export function canManageGeneralPageAllSitesPermission(): boolean {
  return !!permissionsApi();
}

export async function hasGeneralPageAllSitesPermission(): Promise<boolean> {
  try {
    return Boolean(await permissionsApi()?.contains(allHostsPermission()));
  } catch (error) {
    console.warn("[Truly] general page host permission check failed:", error);
    return false;
  }
}

export async function hasGeneralPageHostPermission(rawUrl: string): Promise<boolean> {
  const permission = generalPageOriginPermissionForUrl(rawUrl);
  if (!permission) return false;
  try {
    const api = permissionsApi();
    if (!api) return false;
    if (await api.contains(allHostsPermission())) return true;
    return Boolean(await api.contains(permission));
  } catch (error) {
    console.warn("[Truly] general page domain permission check failed:", error);
    return false;
  }
}

export async function generalPageHostAccessStatus(): Promise<GeneralPageHostAccessStatus> {
  if (!permissionsApi()) return "unavailable";
  return await hasGeneralPageAllSitesPermission() ? "all_sites" : "active_tab_only";
}

export async function requestGeneralPageAllSitesPermission(): Promise<boolean> {
  try {
    return Boolean(await permissionsApi()?.request(allHostsPermission()));
  } catch (error) {
    console.warn("[Truly] general page host permission request failed:", error);
    return false;
  }
}

export async function requestGeneralPageHostPermission(rawUrl: string): Promise<boolean> {
  const permission = generalPageOriginPermissionForUrl(rawUrl);
  if (!permission) return false;
  try {
    return Boolean(await permissionsApi()?.request(permission));
  } catch (error) {
    console.warn("[Truly] general page domain permission request failed:", error);
    return false;
  }
}

export async function removeGeneralPageAllSitesPermission(): Promise<boolean> {
  try {
    return Boolean(await permissionsApi()?.remove(allHostsPermission()));
  } catch (error) {
    console.warn("[Truly] general page host permission removal failed:", error);
    return false;
  }
}
