import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_WITNESS_POINTER_JSON_SCHEMA,
  buildInvestigationWitnessBlocks,
  parseInvestigationWitnessPointerContent,
  reconstructInvestigationWitness,
} from "../../src/lib/claim-investigation-witness-pointer";

const fingerprint = "a".repeat(64);
const text = `${"Background context. ".repeat(15)}The agency recorded 232 affected products on 8 July 2026. ${"Additional context. ".repeat(15)}`;

describe("immutable witness pointers", () => {
  it("keeps the transport schema compatible with constrained grammars", () => {
    const properties = INVESTIGATION_WITNESS_POINTER_JSON_SCHEMA.properties.proposals.items.properties;
    expect(properties.coveredFacets).not.toHaveProperty("uniqueItems");
  });

  it("reconstructs exact source text from a bounded block window", () => {
    const blocks = buildInvestigationWitnessBlocks({ text, documentFingerprint: fingerprint, maxBlockCharacters: 180 });
    const target = blocks.blocks.find((block) => block.text.includes("232 affected"))!;
    const candidate = reconstructInvestigationWitness({
      sourceText: text,
      blockSet: blocks,
      proposal: { version: 1, documentFingerprint: fingerprint, questionId: "q:count", status: "candidate", startBlockId: target.id, endBlockId: target.id, coveredFacets: ["actor", "predicate", "object", "quantity", "time"], reason: "The block states the official count and date." },
      allowedQuestionIds: ["q:count"],
      requiredFacets: ["actor", "predicate", "object", "quantity", "time"],
    });
    expect(candidate?.exactExcerpt).toBe(text.slice(target.startOffset, target.endOffset).trim());
  });

  it("rejects stale fingerprints, oversized windows, and invented facets", () => {
    const blocks = buildInvestigationWitnessBlocks({ text, documentFingerprint: fingerprint, maxBlockCharacters: 180 });
    expect(() => reconstructInvestigationWitness({
      sourceText: `${text} changed`, blockSet: blocks,
      proposal: { version: 1, documentFingerprint: fingerprint, questionId: "q:count", status: "candidate", startBlockId: blocks.blocks[0].id, endBlockId: blocks.blocks[0].id, coveredFacets: [], reason: "candidate" },
      allowedQuestionIds: ["q:count"], requiredFacets: [],
    })).toThrow("Invalid witness proposal boundary");
    expect(() => reconstructInvestigationWitness({
      sourceText: text, blockSet: blocks,
      proposal: { version: 1, documentFingerprint: fingerprint, questionId: "q:count", status: "candidate", startBlockId: blocks.blocks[0].id, endBlockId: blocks.blocks[3].id, coveredFacets: ["quantity"], reason: "candidate" },
      allowedQuestionIds: ["q:count"], requiredFacets: ["quantity"], maxBlockWindow: 3,
    })).toThrow("invalid block window");
  });

  it("parses a constrained pointer response and discards candidate-only abstention filler", () => {
    const parsed = parseInvestigationWitnessPointerContent(JSON.stringify({ proposals: [{ questionId: "q:count", status: "abstain", startBlockId: null, endBlockId: null, coveredFacets: [], reason: "No answering span." }] }), fingerprint);
    expect(parsed?.[0]).toMatchObject({ status: "abstain", documentFingerprint: fingerprint });
    expect(parseInvestigationWitnessPointerContent(JSON.stringify({ proposals: [{ questionId: "q:count", status: "abstain", startBlockId: "grammar-filler", endBlockId: "grammar-filler", coveredFacets: ["quantity"], reason: "No." }] }), fingerprint)?.[0]).toEqual({
      version: 1,
      documentFingerprint: fingerprint,
      questionId: "q:count",
      status: "abstain",
      coveredFacets: [],
      reason: "No.",
    });
  });
});
