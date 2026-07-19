import { describe, expect, it } from "vitest";

import type { EvidenceArtifact } from "../../src/lib/claim-investigation-contract";
import {
  INVESTIGATION_PROOF_CERTIFICATE_VERSION,
  validateInvestigationProofCertificate,
  type InvestigationProofCertificate,
  type InvestigationProofRequirement,
} from "../../src/lib/claim-investigation-proof-certificate";
import type { InvestigationSourceLineageGraph } from "../../src/lib/investigation-source-lineage";

const artifact = (id: string, excerpt: string, origin: string, relation: "supports" | "refutes" = "supports"): EvidenceArtifact => ({
  version: 2,
  id,
  questionId: "question:1",
  sourceRole: "primary",
  publisher: id,
  retrievedAt: "2026-07-15T00:00:00Z",
  exactExcerpt: excerpt,
  sharedOriginGroup: origin,
  relation,
});
const artifacts = [
  artifact("artifact:a", "Agency A states that Product X contains mint.", "origin:a"),
  artifact("artifact:b", "Agency B identifies Product X and the 2026 notice.", "origin:b"),
];
const lineageGraph: InvestigationSourceLineageGraph = {
  version: 1,
  nodes: [
    { artifactId: "artifact:a", originId: "origin:a", derivation: "original" },
    { artifactId: "artifact:b", originId: "origin:b", derivation: "original" },
  ],
};
const requirement: InvestigationProofRequirement = {
  obligationId: "obligation:question:1:answer",
  questionId: "question:1",
  subjectId: "subject:1",
  eventKey: "event:product-x-2026",
  kind: "answer",
  requiredFacets: ["actor", "predicate", "object", "time"],
  acceptableSourceRoles: ["primary"],
  temporalRequired: true,
};
const certificate: InvestigationProofCertificate = {
  version: INVESTIGATION_PROOF_CERTIFICATE_VERSION,
  certificateId: "certificate:1",
  obligationId: requirement.obligationId,
  questionId: requirement.questionId,
  subjectId: requirement.subjectId,
  eventKey: requirement.eventKey,
  kind: "answer",
  witnesses: [
    { artifactId: "artifact:a", exactAnswerSpan: "Product X contains mint", coveredFacets: ["actor", "predicate", "object"], subjectId: "subject:1", eventKey: "event:product-x-2026", temporalEntailment: "not_required" },
    { artifactId: "artifact:b", exactAnswerSpan: "Product X and the 2026 notice", coveredFacets: ["time"], subjectId: "subject:1", eventKey: "event:product-x-2026", temporalEntailment: "aligned" },
  ],
  verdictProduced: false,
};

describe("investigation proof certificates", () => {
  it("accepts conjunctive exact-span evidence bound to one proposition", () => {
    expect(validateInvestigationProofCertificate({ requirement, certificate, artifacts })).toMatchObject({
      ok: true,
      relation: "supports",
      criticalWitnessIds: ["artifact:a", "artifact:b"],
    });
  });

  it("fails closed on cross-question, cross-event, temporal, and relation mismatch", () => {
    const invalidArtifacts = [
      { ...artifacts[0], questionId: "question:other", relation: "refutes" as const },
      artifacts[1],
    ];
    const invalid = {
      ...certificate,
      witnesses: certificate.witnesses.map((witness, index) => index === 0
        ? { ...witness, eventKey: "event:other" }
        : { ...witness, temporalEntailment: "mismatch" as const }),
    };
    const result = validateInvestigationProofCertificate({ requirement, certificate: invalid, artifacts: invalidArtifacts });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "wrong_question", "wrong_binding", "temporal_not_aligned", "conflicting_relation",
    ]));
  });

  it("requires every independent origin to answer fully and deduplicates shared lineage", () => {
    const originRequirement = {
      ...requirement,
      obligationId: "obligation:question:1:origins",
      kind: "independent_origins" as const,
      requiredFacets: ["actor", "predicate", "object"] as const,
      minimumIndependentOrigins: 2,
      temporalRequired: false,
    };
    const originCertificate = {
      ...certificate,
      obligationId: originRequirement.obligationId,
      kind: "independent_origins" as const,
      witnesses: certificate.witnesses.map((witness) => ({ ...witness, coveredFacets: ["actor", "predicate", "object"] as const })),
    };
    expect(validateInvestigationProofCertificate({ requirement: originRequirement, certificate: originCertificate, artifacts, lineageGraph })).toMatchObject({ ok: true, originCount: 2 });
    const sharedLineage: InvestigationSourceLineageGraph = {
      version: 1,
      nodes: [
        { artifactId: "artifact:a", originId: "origin:a", derivation: "original" },
        { artifactId: "artifact:b", originId: "origin:a-copy", derivation: "syndicated", derivedFromArtifactId: "artifact:a" },
      ],
    };
    expect(validateInvestigationProofCertificate({ requirement: originRequirement, certificate: originCertificate, artifacts, lineageGraph: sharedLineage })).toMatchObject({ ok: false, originCount: 1 });
  });

  it("lets exact spans within one lineage jointly cover the proposition", () => {
    const splitArtifacts = [
      ...artifacts,
      artifact("artifact:c", "Agency A published the 2026 notice.", "origin:a"),
      artifact("artifact:d", "Agency B states that Product X contains mint.", "origin:b"),
    ];
    const splitGraph: InvestigationSourceLineageGraph = {
      version: 1,
      nodes: [
        { artifactId: "artifact:a", originId: "origin:a", derivation: "original" },
        { artifactId: "artifact:c", originId: "origin:a", derivation: "quoted", derivedFromArtifactId: "artifact:a" },
        { artifactId: "artifact:b", originId: "origin:b", derivation: "original" },
        { artifactId: "artifact:d", originId: "origin:b", derivation: "quoted", derivedFromArtifactId: "artifact:b" },
      ],
    };
    const originRequirement: InvestigationProofRequirement = {
      ...requirement,
      obligationId: "obligation:question:1:origins",
      kind: "independent_origins",
      requiredFacets: ["actor", "predicate", "object", "time"],
      minimumIndependentOrigins: 2,
    };
    const splitCertificate: InvestigationProofCertificate = {
      ...certificate,
      obligationId: originRequirement.obligationId,
      kind: "independent_origins",
      witnesses: [
        { ...certificate.witnesses[0], coveredFacets: ["actor", "predicate", "object"] },
        { artifactId: "artifact:c", exactAnswerSpan: "2026 notice", coveredFacets: ["time"], subjectId: "subject:1", eventKey: "event:product-x-2026", temporalEntailment: "aligned" },
        { artifactId: "artifact:d", exactAnswerSpan: "Product X contains mint", coveredFacets: ["actor", "predicate", "object"], subjectId: "subject:1", eventKey: "event:product-x-2026", temporalEntailment: "not_required" },
        { ...certificate.witnesses[1], coveredFacets: ["time"] },
      ],
    };
    expect(validateInvestigationProofCertificate({ requirement: originRequirement, certificate: splitCertificate, artifacts: splitArtifacts, lineageGraph: splitGraph })).toMatchObject({ ok: true, originCount: 2 });
  });

  it("fails closed on an invalid requirement boundary", () => {
    const invalidRequirements: InvestigationProofRequirement[] = [
      { ...requirement, requiredFacets: [] },
      { ...requirement, temporalRequired: true, requiredFacets: ["actor", "predicate", "object"] },
      { ...requirement, kind: "independent_origins", minimumIndependentOrigins: 0 },
      { ...requirement, acceptableSourceRoles: [] },
    ];
    invalidRequirements.forEach((invalidRequirement) => {
      const result = validateInvestigationProofCertificate({ requirement: invalidRequirement, certificate, artifacts, lineageGraph });
      expect(result.ok).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain("invalid_requirement");
    });
  });
});
