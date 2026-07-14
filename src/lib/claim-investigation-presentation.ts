import type {
  EvidenceArtifact,
  EvidenceSourceRole,
  InvestigationBundle,
  InvestigationFindingState,
  InvestigationQuestionBasis,
  InvestigationQuestionPurpose,
  EvidenceSufficiencyState,
} from "./claim-investigation-contract";
import { validateInvestigationBundle } from "./claim-investigation-contract";

export interface InvestigationEvidenceCard {
  id: string;
  sourceRole: EvidenceSourceRole;
  relation: EvidenceArtifact["relation"];
  publisher?: string;
  url?: string;
  publishedAt?: string;
  retrievedAt: string;
  exactExcerpt: string;
  duplicateCount: number;
}

export interface InvestigationQuestionGroup {
  id: string;
  basis: InvestigationQuestionBasis;
  purpose: InvestigationQuestionPurpose;
  question: string;
  answered: boolean;
  evidence: InvestigationEvidenceCard[];
}

export interface EvidenceFirstInvestigationPresentation {
  subject: string;
  state: "planned" | EvidenceSufficiencyState;
  questionGroups: InvestigationQuestionGroup[];
  evidenceCount: number;
  independentOriginCount: number;
  unansweredQuestionCount: number;
  sufficiency?: {
    state: EvidenceSufficiencyState;
    rationale: string;
  };
  finding?: {
    state: InvestigationFindingState;
    summary: string;
  };
}

function evidenceOriginKey(artifact: EvidenceArtifact): string {
  if (artifact.sharedOriginGroup) return `shared:${artifact.sharedOriginGroup}`;
  if (artifact.contentFingerprint) return `hash:${artifact.contentFingerprint}`;
  if (artifact.url) {
    try {
      const url = new URL(artifact.url);
      url.hash = "";
      url.search = "";
      return `url:${url.toString()}`;
    } catch {
      // Contract validation reports malformed URLs; keep this function total.
    }
  }
  return `artifact:${artifact.id}`;
}

function deduplicateEvidence(evidence: EvidenceArtifact[]): InvestigationEvidenceCard[] {
  const byOrigin = new Map<string, InvestigationEvidenceCard>();
  for (const artifact of evidence) {
    const key = evidenceOriginKey(artifact);
    const current = byOrigin.get(key);
    if (current) {
      current.duplicateCount += 1;
      continue;
    }
    byOrigin.set(key, {
      id: artifact.id,
      sourceRole: artifact.sourceRole,
      relation: artifact.relation,
      ...(artifact.publisher ? { publisher: artifact.publisher } : {}),
      ...(artifact.url ? { url: artifact.url } : {}),
      ...(artifact.publishedAt ? { publishedAt: artifact.publishedAt } : {}),
      retrievedAt: artifact.retrievedAt,
      exactExcerpt: artifact.exactExcerpt,
      duplicateCount: 1,
    });
  }
  return [...byOrigin.values()];
}

/**
 * Produces a UI-neutral, evidence-first view model. Evidence is grouped under
 * the question it can answer; sufficiency and the bounded finding come later.
 * Duplicate syndication never inflates the independent-origin count.
 */
export function buildEvidenceFirstInvestigationPresentation(
  bundle: InvestigationBundle,
): EvidenceFirstInvestigationPresentation | undefined {
  if (!validateInvestigationBundle(bundle).ok) return undefined;
  const answered = new Set(bundle.sufficiency?.answeredQuestionIds ?? []);
  const questionGroups = bundle.plan.questions.map((question) => ({
    id: question.id,
    basis: question.basis,
    purpose: question.purpose,
    question: question.question,
    answered: answered.has(question.id),
    evidence: deduplicateEvidence(bundle.evidence.filter((artifact) => artifact.questionId === question.id)),
  }));
  const allEvidence = deduplicateEvidence(bundle.evidence);
  return {
    subject: bundle.subject.normalizedClaim,
    state: bundle.sufficiency?.state ?? "planned",
    questionGroups,
    evidenceCount: bundle.evidence.length,
    independentOriginCount: allEvidence.length,
    unansweredQuestionCount: bundle.sufficiency?.unansweredQuestionIds.length ?? bundle.plan.questions.length,
    ...(bundle.sufficiency ? {
      sufficiency: {
        state: bundle.sufficiency.state,
        rationale: bundle.sufficiency.rationale,
      },
    } : {}),
    ...(bundle.finding ? {
      finding: {
        state: bundle.finding.state,
        summary: bundle.finding.summary,
      },
    } : {}),
  };
}
