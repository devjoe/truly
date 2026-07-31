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
      title: "Something went wrong.",
      url: "https://example.test/document",
    })).toBe("unavailable_source");
    expect(generalPageInvestigationSourceRejectionReason({
      title: "發生錯誤",
      url: "https://example.test/document",
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
    for (const url of [
      "https://duffelblog.com/example/",
      "https://hard-drive.net/example/",
      "https://thebeaverton.com/example/",
    ]) {
      expect(generalPageInvestigationSourceRejectionReason({
        title: "A factual-looking headline",
        url,
      }), url).toBe("satire_source");
    }
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

  it("does not treat a longer article headline as a generic error page", () => {
    expect(generalPageInvestigationSourceRejectionReason({
      title: "Something went wrong in the merger talks",
      url: "https://example.test/news/merger-talks",
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
      "Credit: Google The Play Store API is beginning its global rollout",
      "Mike Kemp | In Pictures | Getty Images Ferrari raised its 2026 guidance",
      "ACTION: Notice of application for renewal of exemption; withdrawal",
      "SUMMARY: FMCSA withdrew its earlier notice requesting public comment",
      "DATES: The department will accept public comments for 60 days",
      "Here are the classes: class email.mime.base.MIMEBase(_maintype, _subtype) Module: email.mime.base This is the base class for MIME messages",
      "What you need to know as wildfires continue Wildfires in Spain and France have caused mass evacuation",
      "StatefulSets A StatefulSet runs a group of Pods and maintains a sticky identity for each Pod",
      "PRESS RELEASE Monetary policy decisions 23 July 2026 The Governing Council decided to keep rates unchanged",
      "Original consultation Consultation description The CMA has produced draft revised guidance",
      "A digital form of cash that preserves customer relationships A digital form of cash The digital euro is public money",
      "Key ECB interest rates The interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will remain unchanged",
      "\"Black Panther III\" is set for release Dec",
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

  it("rejects dated entries inside an explicit Page update-history section", () => {
    const context = [
      "Details These framework documents set out the current arrangements.",
      "Updates to this page Published 26 January 2024 Last updated 31 July 2026",
      "31 July 2026 Published the inspectorate framework document.",
      "26 June 2026 Published an updated version of the disclosure framework document.",
      "7 April 2026 The archived authority closed and its responsibilities moved.",
      "Sign up for emails or print this page.",
    ].join(" ");
    for (const exactClaim of [
      "Updates to this page Published 26 January 2024 Last updated 31 July 2026 31 July 2026 Published the inspectorate framework document.",
      "26 June 2026 Published an updated version of the disclosure framework document.",
      "7 April 2026 The archived authority closed and its responsibilities moved.",
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

    const ordinaryClaim =
      "31 July 2026 The agency published its final decision after a public hearing.";
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(ordinaryClaim),
      { authorizedSourceContext: ordinaryClaim },
    )).toBeUndefined();
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

  it("rejects actions from an explicitly self-identified authored course", () => {
    const exactClaim =
      "Social rules are communicated in verbal and nonverbal ways";
    const courseContext = [
      "Social Networking From Wikibooks, open books for an open world.",
      "This is a Networking course by Gerard D. de Gier.",
      exactClaim,
    ].join(" ");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(exactClaim),
      { authorizedSourceContext: courseContext },
    )).toBe("non_publicly_decidable");

    expect(generalPageInvestigationSelectionRejectionReason(
      selection("MessageChannel creates a new message channel"),
      {
        authorizedSourceContext:
          "This guide explains stable platform APIs. MessageChannel creates a new message channel.",
      },
    )).toBeUndefined();
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
      "Credit Suisse announced a new capital plan",
      "Google released the Play Store API globally",
      "The agency summary explains why the exemption was withdrawn",
      "The department will accept public comments for 60 days",
      "MIMEBase is the base class for MIME-specific subclasses of Message",
      "The overview explains that CTEs act like temporary views",
      "The consultation documents will replace CMA37 once they are finalised",
      "The StatefulSet controller maintains a stable identity for each Pod",
      "Wildfires in Spain and France forced more than 300,000 people to evacuate",
      "The Consumer Rights Act 2015 governs unfair terms in consumer contracts",
      "The press release published on 23 July 2026 states that the rates remain unchanged",
      "June 18, 2026 was the date the Federal Reserve issued the enforcement action",
      "The original consultation description explains how the CMA will revise its guidance",
      "A digital form of cash can preserve customer relationships",
      "New York City officials said New York City residents would receive an update",
      "The Federal Reserve Board announced that the Federal Reserve Board would publish the results",
      "Key ECB interest rates remained unchanged after the Governing Council meeting",
      "The interest rates on the deposit facility and refinancing operations will remain unchanged",
      "\"Black Panther III\" is set for release in December",
      "\"Black Panther III\" is set for release Dec. 12, 2026",
    ]) {
      expect(generalPageInvestigationSelectionRejectionReason(
        selection(text),
      ), text).toBeUndefined();
    }
  });

  it("rejects a publication date fused with the complete source title", () => {
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(
        "June 18, 2026 Federal Reserve Board issues enforcement action with former employee of Bank of Eufaula",
      ),
      {
        source: {
          title:
            "Federal Reserve Board issues enforcement action with former employee of Bank of Eufaula",
        },
      },
    )).toBe("page_or_documentation_residue");
    expect(generalPageInvestigationSelectionRejectionReason(
      selection(
        "June 18, 2026 Federal Reserve Board issued an enforcement action with a former employee",
      ),
      {
        source: {
          title:
            "Federal Reserve Board issues enforcement action with former employee of Bank of Eufaula",
        },
      },
    )).toBeUndefined();
  });
});
