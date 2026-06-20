import { describe, expect, it } from "vitest";
import { shouldRenderPersonalContextChip } from "@src/lib/heads-up-chip-policy";

describe("heads-up chip policy", () => {
  it("suppresses the personal-context chip when it duplicates the headline", () => {
    expect(shouldRenderPersonalContextChip("心得", "心得")).toBe(false);
    expect(shouldRenderPersonalContextChip("心得｜AI 文", "心得")).toBe(false);
  });

  it("keeps the personal-context chip when it adds distinct information", () => {
    expect(shouldRenderPersonalContextChip("政治議題", "心得")).toBe(true);
    expect(shouldRenderPersonalContextChip("", "心得")).toBe(true);
  });
});
