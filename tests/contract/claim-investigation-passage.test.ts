import { describe, expect, it } from "vitest";
import { selectExactInvestigationPassage } from "../../src/lib/claim-investigation-passage";

describe("investigation exact-passage selection", () => {
  it("selects an exact passage from fetched document text", () => {
    const result = selectExactInvestigationPassage({
      normalizedClaim: "U.S. farm output nearly tripled between 1948 and 2017.",
      question: "Did U.S. farm output nearly triple between 1948 and 2017?",
      queryCandidates: ["USDA farm production 1948 2017"],
      documentText: [
        "This navigation paragraph describes unrelated USDA services and publications.",
        "Total output produced by U.S. farms nearly tripled between 1948 and 2017, growing at an average annual rate of 1.53 percent.",
        "Contact the Economic Research Service for more information.",
      ].join("\n\n"),
    });
    expect(result?.exactExcerpt).toContain("nearly tripled between 1948 and 2017");
    expect(result?.matchedTerms).toContain("1948");
    expect(result?.matchedTerms).toContain("2017");
  });

  it("does not invent a passage when fetched text lacks enough claim signals", () => {
    expect(selectExactInvestigationPassage({
      normalizedClaim: "Dynaudio will close its North American subsidiary.",
      question: "Did Dynaudio announce a North American closure?",
      queryCandidates: ["Dynaudio North America closure"],
      documentText: "This page contains generic audio product navigation and customer support links only.",
    })).toBeUndefined();
  });

  it("does not accept a search snippet field because the API takes fetched text only", () => {
    const input = {
      normalizedClaim: "India recorded its driest June in 12 years.",
      question: "What rainfall did India record in June?",
      queryCandidates: ["India June rainfall driest 12 years"],
      documentText: "A general weather page discusses seasonal forecasts without the claimed June rainfall figure.",
      searchSnippet: "India recorded its driest June in 12 years.",
    };
    expect(selectExactInvestigationPassage(input)).toBeUndefined();
  });

  it("requires a numeric signal when the verification contract requires quantity", () => {
    const result = selectExactInvestigationPassage({
      normalizedClaim: "USPS detected about 9 million counterfeit-postage packages.",
      question: "Did USPS report about 9 million counterfeit-postage packages?",
      queryCandidates: ["USPS 9 million counterfeit postage packages"],
      requiredFacets: ["actor", "predicate", "object", "quantity", "attribution"],
      documentText: [
        "The agency continues interdictions of packages with counterfeit labels affixed and reviews shipments on postal docks.",
        "In May, an Inspection Service analysis led to an arrest involving more than 9 million pieces of mail with counterfeit postage.",
      ].join("\n\n"),
    });

    expect(result?.exactExcerpt).toContain("more than 9 million pieces of mail");
  });

  it("does not propose a quantity answer from a high-overlap passage with no number", () => {
    expect(selectExactInvestigationPassage({
      normalizedClaim: "USPS detected about 9 million counterfeit-postage packages.",
      question: "Did USPS report about 9 million counterfeit-postage packages?",
      queryCandidates: ["USPS counterfeit postage packages"],
      requiredFacets: ["actor", "predicate", "object", "quantity", "attribution"],
      documentText: "The agency continues interdictions of packages with counterfeit labels affixed.",
    })).toBeUndefined();
  });
});
