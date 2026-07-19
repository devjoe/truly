import { describe, expect, it } from "vitest";

import {
  buildInvestigationSpanCandidates,
  investigationSpanSelectionJsonSchema,
  parseInvestigationSpanSelection,
} from "@src/lib/investigation-span-candidate";

describe("constrained investigation span selection", () => {
  it("builds bounded exact non-compound clauses with stable IDs and offsets", () => {
    const source = "導言。食藥署公布232項產品名單，並要求業者立即下架。金管會表示將持續監理市場。";
    const candidates = buildInvestigationSpanCandidates(source, { maxCandidates: 12, maxCharacters: 120 });
    expect(candidates.map((candidate) => candidate.exactText)).toContain("食藥署公布232項產品名單");
    expect(candidates.map((candidate) => candidate.exactText)).toContain("並要求業者立即下架");
    expect(candidates.every((candidate) => source.slice(candidate.start, candidate.end) === candidate.exactText)).toBe(true);
    expect(candidates.map((candidate) => candidate.id)).toEqual(candidates.map((_, index) => `span:${index + 1}`));
  });

  it("constrains selection to emitted candidate IDs or an explicit abstention", () => {
    const schema = investigationSpanSelectionJsonSchema(["span:1", "span:2"]);
    expect(schema.properties.candidateId.enum).toEqual(["span:1", "span:2", null]);
    expect(parseInvestigationSpanSelection(JSON.stringify({ eligible: true, candidateId: "span:2", abstentionReason: null }), ["span:1", "span:2"]))
      .toEqual({ eligible: true, candidateId: "span:2", abstentionReason: null });
    expect(parseInvestigationSpanSelection(JSON.stringify({ eligible: true, candidateId: "span:9", abstentionReason: null }), ["span:1", "span:2"]))
      .toBeUndefined();
    expect(parseInvestigationSpanSelection(JSON.stringify({ eligible: false, candidateId: null, abstentionReason: "no_checkworthy_claim" }), ["span:1", "span:2"]))
      .toEqual({ eligible: false, candidateId: null, abstentionReason: "no_checkworthy_claim" });
  });
});
