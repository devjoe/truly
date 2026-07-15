import { describe, expect, it } from "vitest";
import type { EvidenceArtifact } from "../../src/lib/claim-investigation-contract";
import {
  resolveInvestigationOriginId,
  validateInvestigationSourceLineageGraph,
  type InvestigationSourceLineageGraph,
} from "../../src/lib/investigation-source-lineage";

const artifacts = ["artifact:a", "artifact:b"].map((id): EvidenceArtifact => ({
  version: 2,
  id,
  questionId: "question:1",
  sourceRole: "primary",
  retrievedAt: "2026-07-15T00:00:00Z",
  exactExcerpt: "synthetic exact excerpt",
  relation: "supports",
}));

describe("investigation source lineage", () => {
  it("deduplicates syndicated derivatives to the root origin", () => {
    const graph: InvestigationSourceLineageGraph = { version: 1, nodes: [
      { artifactId: "artifact:a", originId: "origin:dispatch", derivation: "original" },
      { artifactId: "artifact:b", originId: "origin:publisher-copy", derivation: "syndicated", derivedFromArtifactId: "artifact:a" },
    ] };
    expect(validateInvestigationSourceLineageGraph(graph, artifacts)).toEqual([]);
    expect(resolveInvestigationOriginId(graph, "artifact:b")).toBe("origin:dispatch");
  });

  it("fails closed on unknown parents and cycles", () => {
    const graph: InvestigationSourceLineageGraph = { version: 1, nodes: [
      { artifactId: "artifact:a", originId: "origin:a", derivation: "translated", derivedFromArtifactId: "artifact:b" },
      { artifactId: "artifact:b", originId: "origin:b", derivation: "quoted", derivedFromArtifactId: "artifact:a" },
    ] };
    expect(validateInvestigationSourceLineageGraph(graph, artifacts)).toContain("nodes[0]: lineage cycle");
  });
});
