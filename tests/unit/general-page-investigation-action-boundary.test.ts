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
      title: "The President Meets With Trump",
      url: "https://thehardtimes.net/politics/example/",
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

  it("rejects chapter pages from a known public-domain fiction reader", () => {
    expect(generalPageInvestigationSourceRejectionReason({
      title: "Emma - XI",
      url: "https://standardebooks.org/ebooks/jane-austen/emma/text/chapter-11",
    })).toBe("non_publicly_decidable");
  });

  it("rejects unresolved generic references without rejecting named pairs", () => {
    for (const text of [
      "Both leaders are expected to meet on Tuesday",
      "It was announced on Tuesday",
      "This option removes diacritics",
      "If this option is set to 2, diacritics are removed",
      "Diacritics are removed as described above",
      "The policy followed an unpopular war that many believe was avoidable",
      "One objective is to provide a firm regulatory foundation for digital assets",
      "目標之一是為數位資產提供穩固的監管基礎",
      "The presence of this method distinguishes window aggregate functions",
      "Once finalised, these documents will replace the current guidance",
      "Written representations should be provided by the deadline set out above",
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
      "Today, John writes about how protests changed South Africa",
      "Today’s is about the climate for immigrants in South Africa",
      "We came here to see how Cuba is managing an energy crisis",
      "Parameters value: The value returned when there are no pending Actions. optional reducer(currentState, action): The reducer function",
      "Returns useActionState returns an array with exactly three values: The current state",
      "Returns an iterator allowing iteration through all key/value pairs",
      "參數 value：沒有待處理 Action 時回傳的值。可選 reducer(currentState, action)：指定樂觀狀態如何更新",
      "Khubchandani reports grants or contracts from the National Science Foundation and other financial interests, all outside the submitted work",
      "EDT The Federal Reserve Board announced the stress-test results",
      "Overview with-clause: cte-table-name: select-stmt: Common Table Expressions act like temporary views",
      "From: Published: 31 July 2015 Last updated: 22 July 2026 — Details The Consumer Rights Act 2015 sets out the law",
      "HTTP Source Code: Stability: 2 - Stable This module can be imported via require('node:http')",
      "What you need to know as wildfires continue Wildfires in Spain and France have caused mass evacuation",
      "StatefulSets A StatefulSet runs a group of Pods and maintains a sticky identity for each Pod",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBe("page_or_documentation_residue");
    }
  });

  it("rejects a cited paper title using only its local source role", () => {
    for (const { context, exactClaim } of [
      {
        context:
          "This is a summary of: Aitken, S. J. et al. Genetic background sets the trajectory of experimental cancer evolution. Nature https://doi.org/10.1038/example.",
        exactClaim:
          "Genetic background sets the trajectory of experimental cancer evolution",
      },
      {
        context:
          "本文摘要自：林海等人。背景基因決定實驗性癌症演化軌跡。期刊 DOI:10.0000/example。",
        exactClaim: "背景基因決定實驗性癌症演化軌跡",
      },
    ]) {
      const start = context.indexOf(exactClaim);
      expect(generalPageInvestigationSelectionRejectionReason({
        ...selection(exactClaim),
        start,
        end: start + exactClaim.length,
      }, {
        authorizedSourceContext: context,
      }), exactClaim).toBe("page_or_documentation_residue");
    }
  });

  it("rejects chapter-lead narration and narrow normative payloads", () => {
    expect(generalPageInvestigationSelectionRejectionReason(
      selection("XI For years, Dorian Gray could not free himself from the influence of this book"),
      {
        source: {
          title: "The Picture of Dorian Gray - XI",
          url: "https://books.example/text/chapter-11",
        },
      },
    )).toBe("non_publicly_decidable");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(
        "Modernizing disclosure practices is essential to ensuring that small businesses can thrive",
      ),
    )).toBe("non_publicly_decidable");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection("簡化揭露對確保小型企業蓬勃發展至關重要"),
    )).toBe("non_publicly_decidable");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection("Reviewer Lin Hai said Far Shore was the best film of the year"),
    )).toBe("non_publicly_decidable");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(
        "Gomorrah fans know that, in 30 years’ time, Pietro Savastano will be a king",
      ),
      {
        source: {
          title: "Gomorrah: The Origins review – a mob prequel",
          url: "https://example.test/tv/gomorrah-review",
        },
      },
    )).toBe("non_publicly_decidable");
  });

  it("preserves complete ordinary and documentation propositions", () => {
    for (const text of [
      "The agency published the final report on July 18, 2026",
      "MessageChannel creates a new message channel and returns its two ports",
      "Apple and Google published updates on Tuesday",
      "UTC timestamps identify a single global instant",
      "The documentation source code is published under an open licence",
      "A StatefulSet manages Pods that are based on an identical container specification",
      "The report was published at 4:00 p.m. EDT on June 24, 2026",
      "The Federal Reserve published the stress-test results at 4:00 p.m. EDT",
      "The project uses stability labels for each source code module",
      "The overview explains that CTEs act like temporary views",
      "The consultation documents will replace CMA37 once they are finalised",
      "The StatefulSet controller maintains a stable identity for each Pod",
      "Wildfires in Spain and France forced more than 300,000 people to evacuate",
      "The Consumer Rights Act 2015 governs unfair terms in consumer contracts",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBeUndefined();
    }
  });
});
