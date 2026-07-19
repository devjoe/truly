import type { InvestigationVerificationFacet } from "./claim-investigation-case";

export const INVESTIGATION_WITNESS_POINTER_VERSION = 1 as const;

export interface InvestigationWitnessBlock {
  id: string;
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface InvestigationWitnessBlockSet {
  version: typeof INVESTIGATION_WITNESS_POINTER_VERSION;
  documentFingerprint: string;
  sourceTextLength: number;
  blocks: InvestigationWitnessBlock[];
}

export type InvestigationWitnessPointerProposal =
  | {
      version: typeof INVESTIGATION_WITNESS_POINTER_VERSION;
      documentFingerprint: string;
      questionId: string;
      status: "candidate";
      startBlockId: string;
      endBlockId: string;
      coveredFacets: InvestigationVerificationFacet[];
      reason: string;
    }
  | {
      version: typeof INVESTIGATION_WITNESS_POINTER_VERSION;
      documentFingerprint: string;
      questionId: string;
      status: "abstain";
      coveredFacets: [];
      reason: string;
    };

export interface ReconstructedWitnessCandidate {
  questionId: string;
  exactExcerpt: string;
  startOffset: number;
  endOffset: number;
  coveredFacets: InvestigationVerificationFacet[];
  blockIds: string[];
  documentFingerprint: string;
}

const FACETS = new Set<InvestigationVerificationFacet>([
  "actor", "predicate", "object", "attribution", "time", "place", "quantity",
]);

export function buildInvestigationWitnessBlocks(input: {
  text: string;
  documentFingerprint: string;
  maxBlockCharacters?: number;
  maxBlocks?: number;
}): InvestigationWitnessBlockSet {
  const maxBlockCharacters = input.maxBlockCharacters ?? 600;
  const maxBlocks = input.maxBlocks ?? 160;
  if (!/^[a-f0-9]{16,128}$/iu.test(input.documentFingerprint) || input.text.length < 40 ||
    !Number.isInteger(maxBlockCharacters) || maxBlockCharacters < 160 || maxBlockCharacters > 1_200 ||
    !Number.isInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 400) {
    throw new Error("Invalid witness block input");
  }
  const blocks: InvestigationWitnessBlock[] = [];
  let startOffset = 0;
  while (startOffset < input.text.length && blocks.length < maxBlocks) {
    let endOffset = Math.min(input.text.length, startOffset + maxBlockCharacters);
    if (endOffset < input.text.length) {
      const searchFrom = Math.max(startOffset + Math.floor(maxBlockCharacters * 0.6), startOffset + 1);
      const whitespace = input.text.lastIndexOf(" ", endOffset);
      const newline = input.text.lastIndexOf("\n", endOffset);
      const boundary = Math.max(whitespace, newline);
      if (boundary >= searchFrom) endOffset = boundary + 1;
    }
    if (endOffset <= startOffset) endOffset = Math.min(input.text.length, startOffset + maxBlockCharacters);
    const index = blocks.length;
    blocks.push({
      id: `block:${input.documentFingerprint.slice(0, 16)}:${index}:${startOffset}:${endOffset}`,
      index,
      startOffset,
      endOffset,
      text: input.text.slice(startOffset, endOffset),
    });
    startOffset = endOffset;
  }
  if (startOffset < input.text.length) throw new Error("Document exceeds the witness block limit");
  return { version: 1, documentFingerprint: input.documentFingerprint, sourceTextLength: input.text.length, blocks };
}

export function reconstructInvestigationWitness(input: {
  sourceText: string;
  blockSet: InvestigationWitnessBlockSet;
  proposal: InvestigationWitnessPointerProposal;
  allowedQuestionIds: string[];
  requiredFacets: InvestigationVerificationFacet[];
  maxBlockWindow?: number;
}): ReconstructedWitnessCandidate | undefined {
  const { blockSet, proposal } = input;
  if (proposal.version !== 1 || blockSet.version !== 1 || proposal.documentFingerprint !== blockSet.documentFingerprint ||
    input.sourceText.length !== blockSet.sourceTextLength || !input.allowedQuestionIds.includes(proposal.questionId) ||
    proposal.reason.trim().length === 0 || proposal.reason.length > 320) {
    throw new Error("Invalid witness proposal boundary");
  }
  if (proposal.status === "abstain") return undefined;
  if (new Set(proposal.coveredFacets).size !== proposal.coveredFacets.length ||
    proposal.coveredFacets.some((facet) => !FACETS.has(facet) || !input.requiredFacets.includes(facet))) {
    throw new Error("Witness proposal contains invalid facets");
  }
  const start = blockSet.blocks.find((block) => block.id === proposal.startBlockId);
  const end = blockSet.blocks.find((block) => block.id === proposal.endBlockId);
  const maxBlockWindow = input.maxBlockWindow ?? 3;
  if (!start || !end || end.index < start.index || end.index - start.index + 1 > maxBlockWindow) {
    throw new Error("Witness proposal references an invalid block window");
  }
  for (let index = start.index; index <= end.index; index += 1) {
    const block = blockSet.blocks[index];
    if (!block || block.index !== index || block.startOffset !== (index === 0 ? 0 : blockSet.blocks[index - 1].endOffset) ||
      block.text !== input.sourceText.slice(block.startOffset, block.endOffset)) {
      throw new Error("Witness block set does not match the immutable source text");
    }
  }
  return {
    questionId: proposal.questionId,
    exactExcerpt: input.sourceText.slice(start.startOffset, end.endOffset).trim(),
    startOffset: start.startOffset,
    endOffset: end.endOffset,
    coveredFacets: [...proposal.coveredFacets],
    blockIds: blockSet.blocks.slice(start.index, end.index + 1).map((block) => block.id),
    documentFingerprint: blockSet.documentFingerprint,
  };
}

export const INVESTIGATION_WITNESS_POINTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionId", "status", "startBlockId", "endBlockId", "coveredFacets", "reason"],
        properties: {
          questionId: { type: "string", minLength: 1, maxLength: 128 },
          status: { enum: ["candidate", "abstain"] },
          startBlockId: { type: ["string", "null"], maxLength: 128 },
          endBlockId: { type: ["string", "null"], maxLength: 128 },
          // gx10's constrained grammar does not implement JSON Schema `uniqueItems`.
          // Duplicate facets are still rejected by the local parser/reconstruction guard.
          coveredFacets: { type: "array", maxItems: 7, items: { enum: [...FACETS] } },
          reason: { type: "string", minLength: 1, maxLength: 320 },
        },
      },
    },
  },
} as const;

export function parseInvestigationWitnessPointerContent(
  content: string,
  documentFingerprint: string,
): InvestigationWitnessPointerProposal[] | undefined {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const proposals = (value as Record<string, unknown>).proposals;
  if (!Array.isArray(proposals) || proposals.length < 1 || proposals.length > 8) return undefined;
  const seen = new Set<string>();
  const parsed: InvestigationWitnessPointerProposal[] = [];
  for (const raw of proposals) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.questionId !== "string" || seen.has(entry.questionId) || typeof entry.reason !== "string" || !entry.reason.trim() ||
      !Array.isArray(entry.coveredFacets) || entry.coveredFacets.some((facet) => !FACETS.has(facet as InvestigationVerificationFacet))) return undefined;
    seen.add(entry.questionId);
    if (entry.status === "abstain") {
      // The constrained transport schema keeps a fixed object shape. Some
      // grammar engines therefore populate candidate-only fields even when the
      // discriminant is `abstain`. Those fields have no authority: discard
      // them instead of turning harmless transport filler into a repair loop.
      parsed.push({ version: 1, documentFingerprint, questionId: entry.questionId, status: "abstain", coveredFacets: [], reason: entry.reason });
    } else if (entry.status === "candidate" && typeof entry.startBlockId === "string" && typeof entry.endBlockId === "string") {
      parsed.push({ version: 1, documentFingerprint, questionId: entry.questionId, status: "candidate", startBlockId: entry.startBlockId, endBlockId: entry.endBlockId, coveredFacets: entry.coveredFacets as InvestigationVerificationFacet[], reason: entry.reason });
    } else return undefined;
  }
  return parsed;
}
