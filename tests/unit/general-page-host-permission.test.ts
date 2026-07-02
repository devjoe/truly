import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERAL_PAGE_ALL_HOST_ORIGINS,
  canManageGeneralPageAllSitesPermission,
  generalPageHostAccessStatus,
  hasGeneralPageAllSitesPermission,
  removeGeneralPageAllSitesPermission,
  requestGeneralPageAllSitesPermission,
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
});
