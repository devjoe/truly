import { describe, expect, it } from "vitest";

import { bearerTokenHeaders, jsonRequestHeaders } from "@src/lib/request-auth";

describe("request auth headers", () => {
  it("omits authorization when the API key is empty", () => {
    expect(bearerTokenHeaders("")).toEqual({});
    expect(bearerTokenHeaders("   ")).toEqual({});
    expect(jsonRequestHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("uses a trimmed bearer token when an API key is provided", () => {
    expect(bearerTokenHeaders("  test-key  ")).toEqual({
      Authorization: "Bearer test-key",
    });
    expect(jsonRequestHeaders("test-key")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    });
  });
});
