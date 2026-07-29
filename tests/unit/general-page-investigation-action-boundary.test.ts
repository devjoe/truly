import { describe, expect, it } from "vitest";

import {
  generalPageInvestigationSelectionRejectionReason,
  generalPageInvestigationSourceRejectionReason,
} from "@src/lib/general-page-investigation-action-boundary";

function selection(exactClaim: string) {
  return {
    candidateId: "span:1",
    exactClaim,
    sourceQuote: exactClaim,
    start: 0,
    end: exactClaim.length,
  };
}

describe("General Page investigation local action boundary", () => {
  it("rejects unavailable pages and explicitly classified satire sources", () => {
    expect(generalPageInvestigationSourceRejectionReason({
      title: "Page Not Found - Example",
      url: "https://example.test/",
    })).toBe("unavailable_source");
    expect(generalPageInvestigationSourceRejectionReason({
      title: "A perfectly factual-looking headline",
      sourceName: "The Shovel",
      url: "https://theshovel.com.au/story",
    })).toBe("satire_source");
    expect(generalPageInvestigationSourceRejectionReason({
      title: "今日觀點",
      sourceName: "諷刺新聞",
      url: "https://example.test/story",
    })).toBe("satire_source");
  });

  it("does not infer satire from an ordinary surprising headline", () => {
    expect(generalPageInvestigationSourceRejectionReason({
      title: "Unexpected research result",
      sourceName: "Example Science",
      url: "https://science.example/story",
    })).toBeUndefined();
  });

  it("rejects unresolved generic references without rejecting named pairs", () => {
    for (const text of [
      "Both leaders are expected to meet on Tuesday",
      "It was announced on Tuesday",
      "This option removes diacritics",
      "If this option is set to 2, diacritics are removed",
      "Diacritics are removed as described above",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBe("unresolved_reference");
    }
    for (const text of [
      "Both Apple and Google published updates on Tuesday",
      "If remove_diacritics is set to 2, all Latin diacritics are removed",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBeUndefined();
    }
  });

  it("rejects obvious publisher and flattened documentation residue", () => {
    for (const text of [
      "Supported by A Special Report Prime Minister Lee announced the plan",
      "Documentation Overview Package math provides basic constants and mathematical functions",
      "Max is the largest finite value representable by the type",
      "MinInt = -1 << (intSize - 1) // MinInt32 or MinInt64 depending on intSize",
      "Special cases are: Abs(±Inf) = +Inf Example Output: 2.0 func func Acos(x)",
      "<StrictMode> <StrictMode> lets you find common bugs during development",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBe("page_or_documentation_residue");
    }
  });

  it("preserves complete ordinary and documentation propositions", () => {
    for (const text of [
      "The agency published the final report on July 18, 2026",
      "MessageChannel creates a new message channel and returns its two ports",
      "Apple and Google published updates on Tuesday",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBeUndefined();
    }
  });
});
