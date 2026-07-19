import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERAL_PAGE_ALL_HOST_ORIGINS,
  canManageGeneralPageAllSitesPermission,
  generalPageHostAccessStatus,
  generalPageOriginPermissionForUrl,
  hasGeneralPageAllSitesPermission,
  hasGeneralPageHostPermission,
  removeGeneralPageAllSitesPermission,
  requestGeneralPageAllSitesPermission,
  requestGeneralPageHostPermission,
} from "@src/lib/general-page-host-permission";

function setPermissionsApi(api: unknown): void {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { permissions: api },
  });
}

describe("general page host permission helper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("reports unavailable when the Chrome permissions API is missing", async () => {
    Reflect.deleteProperty(globalThis, "chrome");

    expect(canManageGeneralPageAllSitesPermission()).toBe(false);
    await expect(generalPageHostAccessStatus()).resolves.toBe("unavailable");
    await expect(hasGeneralPageAllSitesPermission()).resolves.toBe(false);
  });

  it("checks, requests, and removes the all-sites origins", async () => {
    const contains = vi.fn(async () => true);
    const request = vi.fn(async () => true);
    const remove = vi.fn(async () => true);
    setPermissionsApi({ contains, request, remove });

    expect(canManageGeneralPageAllSitesPermission()).toBe(true);
    await expect(generalPageHostAccessStatus()).resolves.toBe("all_sites");
    await expect(requestGeneralPageAllSitesPermission()).resolves.toBe(true);
    await expect(removeGeneralPageAllSitesPermission()).resolves.toBe(true);

    const expected = { origins: [...GENERAL_PAGE_ALL_HOST_ORIGINS] };
    expect(contains).toHaveBeenCalledWith(expected);
    expect(request).toHaveBeenCalledWith(expected);
    expect(remove).toHaveBeenCalledWith(expected);
  });

  it("keeps activeTab-only status when all-sites access is not granted", async () => {
    setPermissionsApi({
      contains: vi.fn(async () => false),
      request: vi.fn(async () => false),
      remove: vi.fn(async () => false),
    });

    await expect(generalPageHostAccessStatus()).resolves.toBe("active_tab_only");
    await expect(requestGeneralPageAllSitesPermission()).resolves.toBe(false);
  });

  it("checks and requests a single page origin", async () => {
    const contains = vi.fn(async (permissions: chrome.permissions.Permissions) =>
      permissions.origins?.[0] === "https://example.test/*"
    );
    const request = vi.fn(async () => true);
    setPermissionsApi({ contains, request, remove: vi.fn(async () => true) });

    expect(generalPageOriginPermissionForUrl("https://example.test/article")).toEqual({
      origins: ["https://example.test/*"],
    });
    await expect(hasGeneralPageHostPermission("https://example.test/article")).resolves.toBe(true);
    await expect(requestGeneralPageHostPermission("https://example.test/article")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["https://example.test/*"] });
  });
});
