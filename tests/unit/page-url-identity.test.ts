import { describe, expect, it } from "vitest";
import {
  isMeaningfullySamePage,
  normalizePageUrl,
  pageUrlIdentity,
} from "../../src/lib/page-url-identity";

describe("page url identity", () => {
  it("ignores hash-only changes", () => {
    const identity = pageUrlIdentity("https://example.com/report#intro");

    expect(isMeaningfullySamePage(identity, "https://example.com/report#comments")).toBe(true);
  });

  it("ignores tracking and cosmetic query parameters", () => {
    const identity = pageUrlIdentity("https://example.com/report?utm_source=feed&fbclid=123");

    expect(isMeaningfullySamePage(identity, "https://example.com/report?utm_campaign=next")).toBe(true);
  });

  it("keeps content-bearing query parameters", () => {
    const identity = pageUrlIdentity("https://example.com/report?id=1&utm_source=feed");

    expect(isMeaningfullySamePage(identity, "https://example.com/report?id=2&utm_source=feed")).toBe(false);
  });

  it("normalizes default ports and trailing slashes", () => {
    expect(normalizePageUrl("https://example.com:443/report/")).toBe("https://example.com/report");
  });

  it("prefers canonical url when provided", () => {
    const identity = pageUrlIdentity(
      "https://example.com/report?utm_source=feed",
      "https://example.com/canonical-report",
    );

    expect(isMeaningfullySamePage(identity, "https://example.com/canonical-report#top")).toBe(true);
  });
});
