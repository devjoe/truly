import type { GeneralPageBrief } from "../src/lib/general-page-analysis";
import type { GeneralPageInvestigationAdapterBatchValue } from "../src/lib/general-page-investigation-adapter";
import type { Lang } from "../src/lib/types";
import {
  preparePageClaimInvestigation,
  type PageClaimInvestigationCanonicalization,
  type PageClaimInvestigationIneligibilityReason,
  type PageClaimInvestigationSource,
  type PageClaimInvestigationTask,
} from "../src/sidepanel/page-claim-investigation";
import {
  buildReadingBriefQuestionActionPayload,
  type ReadingBriefQuestionActionPayload,
  type ReadingBriefQuestionActionSource,
} from "../src/sidepanel/reading-brief-text";

/**
 * Uses the same typed projection as the Page/Focus UI. These are inert strings
 * and a contract-only agent draft; this helper never opens a URL or dispatches
 * an action.
 */
export function buildPrivateSemanticAuditQuestionActions(input: {
  brief: GeneralPageBrief;
  lang: Lang;
  source?: ReadingBriefQuestionActionSource;
}): ReadingBriefQuestionActionPayload[] {
  return (input.brief.qs ?? []).map((question) => buildReadingBriefQuestionActionPayload({
    question: question.q,
    kind: question.kind,
    lang: input.lang,
    source: {
      ...input.source,
      summary: input.source?.summary || input.brief.summary,
    },
  }));
}

export interface PrivateSemanticAuditAdapterBatchProjectionItem {
  claimIndex: number;
  adapterDecision: "prepared" | "abstain" | "invalid";
  preparation: {
    decision: "prepared" | "rejected";
    canonicalizations: PageClaimInvestigationCanonicalization[];
    reason?: PageClaimInvestigationIneligibilityReason;
  } | null;
}

export interface PrivateSemanticAuditAdapterBatchProjection {
  pipelineStatus: "action_ready" | "local_guard_rejected" | "adapter_abstained";
  preparations: PrivateSemanticAuditAdapterBatchProjectionItem[];
  investigationTasks: PageClaimInvestigationTask[];
  localGuardReasons: PageClaimInvestigationIneligibilityReason[];
}

/**
 * Mirrors the product runtime's bounded batch projection. Every candidate is
 * evaluated independently; one accepted item must not hide abstained or
 * locally rejected siblings in a private audit record.
 */
export function projectPrivateSemanticAuditAdapterBatch(input: {
  batch: GeneralPageInvestigationAdapterBatchValue;
  analysisKey: string;
  groundingText: string;
  source?: PageClaimInvestigationSource;
  scope?: "page" | "focus";
}): PrivateSemanticAuditAdapterBatchProjection {
  const investigationTasks: PageClaimInvestigationTask[] = [];
  const localGuardReasons: PageClaimInvestigationIneligibilityReason[] = [];
  const preparations = input.batch.results.map((item): PrivateSemanticAuditAdapterBatchProjectionItem => {
    if (item.value?.decision !== "prepared") {
      return {
        claimIndex: item.claimIndex,
        adapterDecision: item.value?.decision === "abstain" ? "abstain" : "invalid",
        preparation: null,
      };
    }
    const preparation = preparePageClaimInvestigation({
      analysisKey: input.analysisKey,
      scope: input.scope ?? "page",
      claimIndex: item.claimIndex,
      claim: item.value.claim,
      groundingText: input.groundingText,
      source: input.source,
    });
    if (preparation.decision === "prepared") {
      investigationTasks.push(preparation.task);
      return {
        claimIndex: item.claimIndex,
        adapterDecision: "prepared",
        preparation: {
          decision: "prepared",
          canonicalizations: preparation.canonicalizations,
        },
      };
    }
    localGuardReasons.push(preparation.reason);
    return {
      claimIndex: item.claimIndex,
      adapterDecision: "prepared",
      preparation: {
        decision: "rejected",
        reason: preparation.reason,
        canonicalizations: preparation.canonicalizations,
      },
    };
  });
  return {
    pipelineStatus: investigationTasks.length > 0
      ? "action_ready"
      : localGuardReasons.length > 0
      ? "local_guard_rejected"
      : "adapter_abstained",
    preparations,
    investigationTasks,
    localGuardReasons,
  };
}
