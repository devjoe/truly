import type { DashboardPostEvent } from "../lib/types";

export function eventTextKey(event: DashboardPostEvent): string {
  return (event.fullText || event.text || "").replace(/\s+/g, " ").trim();
}

export function mergeProgressivePostContext(
  event: DashboardPostEvent,
  previous: DashboardPostEvent | undefined,
): DashboardPostEvent {
  if (!previous) return event;
  const merged: DashboardPostEvent = {
    ...event,
    text: event.text || previous.text,
    fullText: event.fullText || previous.fullText,
    authorName: event.authorName || previous.authorName,
    sourceName: event.sourceName || previous.sourceName,
    postType: event.postType ?? previous.postType,
    contentKind: event.contentKind ?? previous.contentKind,
    sharedAttachmentText: event.sharedAttachmentText ?? previous.sharedAttachmentText,
    reshareOriginalText: event.reshareOriginalText ?? previous.reshareOriginalText,
    reshareOriginalAuthor: event.reshareOriginalAuthor ?? previous.reshareOriginalAuthor,
    postUrl: event.postUrl ?? previous.postUrl,
    pageUrl: event.pageUrl ?? previous.pageUrl,
    textCompleteness: event.textCompleteness ?? previous.textCompleteness,
  };
  const sameZhtwText = eventTextKey(merged) === eventTextKey(previous);
  return {
    ...merged,
    sourceContext: event.sourceContext ?? (sameZhtwText ? previous.sourceContext : undefined),
    zhtwReview: sameZhtwText
      ? event.zhtwReview ?? event.decision.zhtwReview ?? previous.zhtwReview ?? previous.decision.zhtwReview
      : event.zhtwReview ?? event.decision.zhtwReview,
    zhtwReviewError: sameZhtwText ? event.zhtwReviewError ?? previous.zhtwReviewError : event.zhtwReviewError,
  };
}

export function mergeReadingBriefState(
  event: DashboardPostEvent,
  previous: DashboardPostEvent | undefined,
): DashboardPostEvent {
  if (!previous) return event;
  if (event.readingBrief || event.readingBriefPending || event.readingBriefError) return event;
  if (!previous.readingBrief && !previous.readingBriefPending && !previous.readingBriefError) return event;
  const currentOutputLang = event.decision.deepClassification?.outputLang;
  if (previous.readingBrief && currentOutputLang && previous.readingBrief.outputLang !== currentOutputLang) {
    return event;
  }
  const sameText = (event.fullText || event.text || "") === (previous.fullText || previous.text || "");
  const sameDeep =
    event.decision.deepClassification?.model === previous.decision.deepClassification?.model &&
    event.decision.deepClassification?.summary === previous.decision.deepClassification?.summary &&
    event.decision.deepClassification?.outputLang === previous.decision.deepClassification?.outputLang;
  if (!sameText || !sameDeep) {
    if (!previous.readingBrief) return event;
    return {
      ...event,
      readingBrief: previous.readingBrief,
      readingBriefStale: true,
      readingBriefError: undefined,
    };
  }
  return {
    ...event,
    readingBrief: previous.readingBrief,
    readingBriefPending: previous.readingBriefPending,
    readingBriefStale: previous.readingBriefStale,
    readingBriefError: previous.readingBriefError,
  };
}
