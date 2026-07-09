import { describe, expect, it } from "vitest";

import { shouldShowPageReadCurrentAction } from "@src/sidepanel/tabs";

describe("sidepanel tab actions", () => {
  it("shows the page read action only on the Web tab", () => {
    expect(shouldShowPageReadCurrentAction("analysis")).toBe(false);
    expect(shouldShowPageReadCurrentAction("page")).toBe(true);
    expect(shouldShowPageReadCurrentAction("focus")).toBe(false);
  });
});
