import type { GeneralPageBrief } from "../src/lib/general-page-analysis";
import type { Lang } from "../src/lib/types";
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

