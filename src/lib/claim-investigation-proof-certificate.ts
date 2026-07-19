import type { EvidenceArtifact, EvidenceRelation, EvidenceSourceRole } from "./claim-investigation-contract";
import type { InvestigationVerificationFacet } from "./claim-investigation-case";
import {
  resolveInvestigationOriginId,
  validateInvestigationSourceLineageGraph,
  type InvestigationSourceLineageGraph,
} from "./investigation-source-lineage";

export const INVESTIGATION_PROOF_CERTIFICATE_VERSION = 2 as const;

export type InvestigationProofCertificateKind = "answer" | "independent_origins";
export type InvestigationTemporalEntailment = "not_required" | "aligned" | "mismatch" | "unknown";

export interface InvestigationProofRequirement {
  obligationId: string;
  questionId: string;
  subjectId: string;
  eventKey: string;
  kind: InvestigationProofCertificateKind;
  requiredFacets: InvestigationVerificationFacet[];
  acceptableSourceRoles: EvidenceSourceRole[];
  minimumIndependentOrigins?: number;
  temporalRequired: boolean;
}

export interface InvestigationProofWitness {
  artifactId: string;
  exactAnswerSpan: string;
  coveredFacets: InvestigationVerificationFacet[];
  subjectId: string;
  eventKey: string;
  temporalEntailment: InvestigationTemporalEntailment;
}

export interface InvestigationProofCertificate {
  version: typeof INVESTIGATION_PROOF_CERTIFICATE_VERSION;
  certificateId: string;
  obligationId: string;
  questionId: string;
  subjectId: string;
  eventKey: string;
  kind: InvestigationProofCertificateKind;
  witnesses: InvestigationProofWitness[];
  verdictProduced: false;
}

export type InvestigationProofCertificateIssueCode =
  | "invalid_requirement"
  | "wrong_obligation"
  | "wrong_question"
  | "wrong_binding"
  | "missing_artifact"
  | "non_exact_span"
  | "unsupported_source_role"
  | "non_answering_relation"
  | "conflicting_relation"
  | "missing_facet"
  | "duplicate_facet"
  | "temporal_not_aligned"
  | "origin_unavailable"
  | "origin_shortfall"
  | "invalid_lineage"
  | "invalid_certificate";

export interface InvestigationProofCertificateValidation {
  ok: boolean;
  issues: Array<{ code: InvestigationProofCertificateIssueCode; path: string; message: string }>;
  relation?: "supports" | "refutes";
  originCount: number;
  criticalWitnessIds: string[];
}

const FACETS = new Set<InvestigationVerificationFacet>([
  "actor", "predicate", "object", "attribution", "time", "place", "quantity",
]);
const SOURCE_ROLES = new Set<EvidenceSourceRole>([
  "primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied",
]);

function validateProofRequirement(requirement: InvestigationProofRequirement): string[] {
  const issues: string[] = [];
  const ids = [requirement.obligationId, requirement.questionId, requirement.subjectId, requirement.eventKey];
  if (ids.some((value) => typeof value !== "string" || !value.trim())) issues.push("identity fields must be non-empty");
  if (!Array.isArray(requirement.requiredFacets) || requirement.requiredFacets.length < 1 ||
    new Set(requirement.requiredFacets).size !== requirement.requiredFacets.length ||
    requirement.requiredFacets.some((facet) => !FACETS.has(facet))) issues.push("required facets must be non-empty, supported, and unique");
  if (!Array.isArray(requirement.acceptableSourceRoles) || requirement.acceptableSourceRoles.length < 1 ||
    new Set(requirement.acceptableSourceRoles).size !== requirement.acceptableSourceRoles.length ||
    requirement.acceptableSourceRoles.some((role) => !SOURCE_ROLES.has(role))) issues.push("acceptable source roles must be non-empty, supported, and unique");
  if (typeof requirement.temporalRequired !== "boolean" ||
    (requirement.temporalRequired && !requirement.requiredFacets.includes("time"))) issues.push("temporal proof must require the time facet");
  if (requirement.kind === "independent_origins") {
    if (!Number.isInteger(requirement.minimumIndependentOrigins) || (requirement.minimumIndependentOrigins ?? 0) < 2 || (requirement.minimumIndependentOrigins ?? 0) > 8) {
      issues.push("independent-origin proof requires an explicit minimum from 2 to 8");
    }
  } else if (requirement.minimumIndependentOrigins !== undefined) {
    issues.push("answer proof cannot declare an independent-origin minimum");
  }
  return issues;
}

function originKey(artifact: EvidenceArtifact): string | undefined {
  if (artifact.sharedOriginGroup?.trim()) return `shared:${artifact.sharedOriginGroup.trim().toLowerCase()}`;
  if (artifact.publisher?.trim()) return `publisher:${artifact.publisher.trim().toLowerCase()}`;
  if (artifact.url) {
    try { return `host:${new URL(artifact.url).hostname.toLowerCase()}`; }
    catch { return undefined; }
  }
  return undefined;
}

function answeringRelation(relation: EvidenceRelation): relation is "supports" | "refutes" {
  return relation === "supports" || relation === "refutes";
}

export function validateInvestigationProofCertificate(input: {
  requirement: InvestigationProofRequirement;
  certificate: InvestigationProofCertificate;
  artifacts: EvidenceArtifact[];
  lineageGraph?: InvestigationSourceLineageGraph;
}): InvestigationProofCertificateValidation {
  const { requirement, certificate } = input;
  const issues: InvestigationProofCertificateValidation["issues"] = [];
  const issue = (code: InvestigationProofCertificateIssueCode, path: string, message: string) => issues.push({ code, path, message });
  validateProofRequirement(requirement).forEach((message) => issue("invalid_requirement", "requirement", message));
  if (certificate.version !== INVESTIGATION_PROOF_CERTIFICATE_VERSION || certificate.verdictProduced !== false || certificate.witnesses.length === 0) {
    issue("invalid_certificate", "certificate", "must use version 2, contain witnesses, and never produce a verdict");
  }
  if (certificate.obligationId !== requirement.obligationId || certificate.kind !== requirement.kind) {
    issue("wrong_obligation", "certificate.obligationId", "must match the typed proof requirement");
  }
  if (certificate.questionId !== requirement.questionId) issue("wrong_question", "certificate.questionId", "must match the proof question");
  if (certificate.subjectId !== requirement.subjectId || certificate.eventKey !== requirement.eventKey) {
    issue("wrong_binding", "certificate", "must bind the required subject and event frame");
  }
  const artifactById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  if (artifactById.size !== input.artifacts.length) issue("invalid_certificate", "artifacts", "artifact IDs must be unique");
  const relations = new Set<"supports" | "refutes">();
  const unionFacets = new Set<InvestigationVerificationFacet>();
  if (input.lineageGraph) {
    validateInvestigationSourceLineageGraph(input.lineageGraph, input.artifacts).forEach((message) => issue("invalid_lineage", "lineageGraph", message));
  } else if (requirement.kind === "independent_origins") {
    issue("invalid_lineage", "lineageGraph", "independent-origin proof requires an explicit lineage graph");
  }
  const origins = new Set<string>();
  const validWitnesses: Array<{ witness: InvestigationProofWitness; artifact: EvidenceArtifact }> = [];
  certificate.witnesses.forEach((witness, index) => {
    const path = `certificate.witnesses[${index}]`;
    const artifact = artifactById.get(witness.artifactId);
    if (!artifact) { issue("missing_artifact", `${path}.artifactId`, "must reference an immutable evidence artifact"); return; }
    if (artifact.questionId !== requirement.questionId) issue("wrong_question", `${path}.artifactId`, "artifact was collected for another question");
    if (witness.subjectId !== requirement.subjectId || witness.eventKey !== requirement.eventKey) {
      issue("wrong_binding", path, "every witness must bind the same subject and event frame");
    }
    if (!witness.exactAnswerSpan || !artifact.exactExcerpt.includes(witness.exactAnswerSpan)) {
      issue("non_exact_span", `${path}.exactAnswerSpan`, "must be an exact substring of the fetched artifact");
    }
    if (!requirement.acceptableSourceRoles.includes(artifact.sourceRole)) {
      issue("unsupported_source_role", `${path}.artifactId`, "artifact source role is not entitled for this proof");
    }
    if (!answeringRelation(artifact.relation)) issue("non_answering_relation", `${path}.artifactId`, "context or irrelevant artifacts cannot prove an obligation");
    else relations.add(artifact.relation);
    const seenFacets = new Set<InvestigationVerificationFacet>();
    witness.coveredFacets.forEach((facet, facetIndex) => {
      if (!FACETS.has(facet)) issue("missing_facet", `${path}.coveredFacets[${facetIndex}]`, "contains an unsupported facet");
      else if (seenFacets.has(facet)) issue("duplicate_facet", `${path}.coveredFacets[${facetIndex}]`, "facet coverage must be unique");
      else { seenFacets.add(facet); unionFacets.add(facet); }
    });
    if (requirement.temporalRequired && seenFacets.has("time") && witness.temporalEntailment !== "aligned") {
      issue("temporal_not_aligned", `${path}.temporalEntailment`, "a time witness must entail the frozen event frame");
    }
    const key = input.lineageGraph ? resolveInvestigationOriginId(input.lineageGraph, artifact.id) : originKey(artifact);
    if (key) origins.add(key);
    else if (requirement.kind === "independent_origins") issue("origin_unavailable", `${path}.artifactId`, "origin proof requires a stable lineage key");
    validWitnesses.push({ witness, artifact });
  });
  if (relations.size > 1) issue("conflicting_relation", "certificate.witnesses", "all witnesses must answer with the same relation");
  if (requirement.kind === "answer") {
    requirement.requiredFacets.forEach((facet) => {
      if (!unionFacets.has(facet)) issue("missing_facet", "certificate.witnesses", `joint evidence does not cover ${facet}`);
    });
  } else {
    const facetsByOrigin = new Map<string, Set<InvestigationVerificationFacet>>();
    validWitnesses.forEach(({ witness, artifact }) => {
      const key = input.lineageGraph ? resolveInvestigationOriginId(input.lineageGraph, artifact.id) : originKey(artifact);
      if (!key) return;
      const facets = facetsByOrigin.get(key) ?? new Set<InvestigationVerificationFacet>();
      witness.coveredFacets.forEach((facet) => facets.add(facet));
      facetsByOrigin.set(key, facets);
    });
    facetsByOrigin.forEach((facets, key) => requirement.requiredFacets.forEach((facet) => {
      if (!facets.has(facet)) issue("missing_facet", `certificate.witnesses[lineage=${key}]`, `each independent lineage must jointly cover ${facet}`);
    }));
    const minimum = requirement.minimumIndependentOrigins ?? Number.POSITIVE_INFINITY;
    const qualifyingOrigins = [...facetsByOrigin].filter(([, facets]) => requirement.requiredFacets.every((facet) => facets.has(facet))).map(([key]) => key);
    origins.clear();
    qualifyingOrigins.forEach((key) => origins.add(key));
    if (origins.size < minimum) issue("origin_shortfall", "certificate.witnesses", `requires ${minimum} fully answering independent origins; found ${origins.size}`);
  }
  const criticalWitnessIds = certificate.witnesses.filter((removed) => {
    const reduced = certificate.witnesses.filter((witness) => witness !== removed);
    if (requirement.kind === "independent_origins") {
      const reducedFacetsByOrigin = new Map<string, Set<InvestigationVerificationFacet>>();
      reduced.forEach((witness) => {
        const artifact = artifactById.get(witness.artifactId);
        const key = artifact && (input.lineageGraph ? resolveInvestigationOriginId(input.lineageGraph, artifact.id) : originKey(artifact));
        if (!key) return;
        const facets = reducedFacetsByOrigin.get(key) ?? new Set<InvestigationVerificationFacet>();
        witness.coveredFacets.forEach((facet) => facets.add(facet));
        reducedFacetsByOrigin.set(key, facets);
      });
      const fullyAnsweringOrigins = [...reducedFacetsByOrigin.values()].filter((facets) => requirement.requiredFacets.every((facet) => facets.has(facet))).length;
      return fullyAnsweringOrigins < (requirement.minimumIndependentOrigins ?? Number.POSITIVE_INFINITY);
    }
    const reducedFacets = new Set(reduced.flatMap((witness) => witness.coveredFacets));
    return requirement.requiredFacets.some((facet) => !reducedFacets.has(facet));
  }).map((witness) => witness.artifactId);
  return {
    ok: issues.length === 0,
    issues,
    relation: relations.size === 1 ? [...relations][0] : undefined,
    originCount: origins.size,
    criticalWitnessIds,
  };
}
