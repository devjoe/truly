import type { EvidenceArtifact } from "../../src/lib/claim-investigation-contract";
import type { EvidencePassageAssessment } from "../../src/lib/claim-investigation-evidence";

export interface ReviewMergeRetrievalRow {
  sampleId: string;
  targetRuns: Array<{ questionRuns?: Array<{ status: string; evidence?: EvidenceArtifact }> }>;
}

export interface ReviewMergePartRow {
  sampleId: string;
  assessments: EvidencePassageAssessment[];
}

export function mergeInvestigationReviewParts(input: {
  retrievalRows: ReviewMergeRetrievalRow[];
  reviewParts: Array<{ rows: ReviewMergePartRow[] }>;
}): ReviewMergePartRow[] {
  const expectedSamples = new Set(input.retrievalRows.map((row) => row.sampleId));
  if (expectedSamples.size !== input.retrievalRows.length) throw new Error("Retrieval samples must be unique");
  const reviews = new Map<string, EvidencePassageAssessment[]>();
  input.reviewParts.flatMap((part) => part.rows).forEach((row) => {
    if (!expectedSamples.has(row.sampleId)) throw new Error(`Unexpected review sample ${row.sampleId}`);
    if (reviews.has(row.sampleId)) throw new Error(`Duplicate review sample ${row.sampleId}`);
    reviews.set(row.sampleId, row.assessments);
  });
  if (reviews.size !== expectedSamples.size || [...expectedSamples].some((sampleId) => !reviews.has(sampleId))) {
    throw new Error("Review samples must exactly match retrieval samples, including rows with no passage candidates");
  }
  return input.retrievalRows.map((retrieval) => {
    const artifacts = retrieval.targetRuns.flatMap((target) => target.questionRuns ?? [])
      .filter((run) => run.status === "passage_candidate_extracted" && run.evidence)
      .map((run) => run.evidence!);
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    if (artifactById.size !== artifacts.length) throw new Error(`${retrieval.sampleId}: duplicate retrieval artifact ID`);
    const assessments = reviews.get(retrieval.sampleId) ?? [];
    if (new Set(assessments.map((assessment) => assessment.artifactId)).size !== assessments.length) {
      throw new Error(`${retrieval.sampleId}: duplicate assessment artifact ID`);
    }
    if (assessments.length !== artifacts.length) {
      throw new Error(`${retrieval.sampleId}: every passage candidate requires exactly one assessment`);
    }
    assessments.forEach((assessment) => {
      const artifact = artifactById.get(assessment.artifactId);
      if (!artifact || artifact.questionId !== assessment.questionId) {
        throw new Error(`${retrieval.sampleId}: assessment references the wrong artifact or question`);
      }
      if (assessment.exactAnswerSpan && !artifact.exactExcerpt.includes(assessment.exactAnswerSpan)) {
        throw new Error(`${retrieval.sampleId}: exact answer span is not in the fetched excerpt`);
      }
    });
    return { sampleId: retrieval.sampleId, assessments };
  });
}
