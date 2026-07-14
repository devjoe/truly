import { describe, expect, it } from "vitest";

import {
  INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA,
  detectCompoundPropositionSignal,
  investigationPlannerSystemPrompt,
  materializeHumanPreselectedAtomicPlan,
  materializeInvestigationPlan,
  parseInvestigationPlanDraftContent,
  preselectedInvestigationPlannerSystemPrompt,
  preselectedInvestigationPlannerUserPrompt,
} from "@src/lib/claim-investigation-planner";

const eligibleDraft = {
  schemaVersion: 2,
  eligible: true,
  abstentionReason: null,
  subject: {
    originalSpan: "Example Agency announced 232 affected products on July 8.",
    normalizedClaim: "Example Agency announced 232 affected products on July 8.",
    attribution: null,
    proposition: {
      originalSpan: "Example Agency announced 232 affected products on July 8.",
      normalizedText: "Example Agency announced 232 affected products on July 8.",
      time: "July 8",
      place: null,
      quantity: "232",
    },
    consequence: "safety",
  },
  plan: {
    questions: [{
      basis: "literal",
      purpose: "quantity",
      question: "Did Example Agency announce 232 affected products on July 8?",
      queryCandidates: ["Example Agency 232 affected products July 8"],
      preferredSourceRoles: ["primary", "independent_secondary"],
    }],
    timeCutoff: null,
    minimumIndependentSources: 1,
    stoppingConditions: ["Find the agency notice and product list."],
  },
};

describe("Claim Investigation planner draft contract", () => {
  it("uses a strict object schema with nullable abstention branches", () => {
    expect(INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA.required).toEqual([
      "schemaVersion", "eligible", "abstentionReason", "subject", "plan",
    ]);
    expect(JSON.stringify(INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA)).toContain("counterevidence");
  });

  it("parses and materializes a grounded model draft", () => {
    const parsed = parseInvestigationPlanDraftContent(JSON.stringify(eligibleDraft));
    expect(parsed).toBeDefined();
    const result = materializeInvestigationPlan(parsed!, {
      sampleId: "syn_planner",
      scope: "page",
      sourceText: "Lead. Example Agency announced 232 affected products on July 8. Tail.",
      contentFingerprint: "0123456789abcdef0123456789abcdef",
      observedAt: "2026-07-14T02:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.subject.id).toBe("subject:syn_planner");
    expect(result.bundle.plan.questions[0]).toMatchObject({ id: "question:syn_planner:1" });
    expect(result.bundle.subject.proposition.quantity).toBe("232");
  });

  it("rejects an original span or atomic proposition span not grounded in source text", () => {
    const parsed = parseInvestigationPlanDraftContent(JSON.stringify(eligibleDraft))!;
    expect(materializeInvestigationPlan(parsed, {
      sampleId: "syn_missing",
      scope: "page",
      sourceText: "No matching sentence is present.",
      contentFingerprint: "0123456789abcdef0123456789abcdef",
      observedAt: "2026-07-14T02:00:00Z",
    })).toMatchObject({ ok: false, error: "ungrounded_span" });

    const changed = structuredClone(eligibleDraft);
    changed.subject.proposition.originalSpan = "Example Agency announced 999 affected products.";
    const changedParsed = parseInvestigationPlanDraftContent(JSON.stringify(changed))!;
    expect(materializeInvestigationPlan(changedParsed, {
      sampleId: "syn_bad_atom",
      scope: "page",
      sourceText: eligibleDraft.subject.originalSpan,
      contentFingerprint: "0123456789abcdef0123456789abcdef",
      observedAt: "2026-07-14T02:00:00Z",
    })).toMatchObject({ ok: false, error: "ungrounded_proposition" });
  });

  it("accepts a fully explicit abstention and rejects mixed states", () => {
    expect(parseInvestigationPlanDraftContent(JSON.stringify({
      schemaVersion: 2,
      eligible: false,
      abstentionReason: "low_consequence",
      subject: null,
      plan: null,
    }))).toMatchObject({ eligible: false, abstentionReason: "low_consequence" });
    expect(parseInvestigationPlanDraftContent(JSON.stringify({
      schemaVersion: 2,
      eligible: false,
      abstentionReason: "low_consequence",
      subject: eligibleDraft.subject,
      plan: null,
    }))).toBeUndefined();
  });

  it("keeps the prompt on planning and explicitly forbids a verdict", () => {
    const prompt = investigationPlannerSystemPrompt("zh-TW");
    expect(prompt).toContain("Traditional Chinese (Taiwan)");
    expect(prompt).toContain("do not assign a verdict");
    expect(prompt).toContain("Existing fact checks are a discovery lane");
    expect(prompt).toContain("character-for-character");
    expect(prompt).toContain("Do not force English-style subject/predicate/object segmentation");
    expect(prompt).toContain("Select exactly one atomic proposition");
    expect(prompt).toContain("attributes, not additional propositions");
    expect(prompt).toContain("Never use allegation merely because a claim is unverified");
    expect(prompt).toContain("never use forecast for historical or current data");
    expect(prompt).toContain("Use attribution=null for an event actor, author/byline, or page date");
    expect(prompt).toContain("completed is not published");
    expect(prompt).toContain("Never request private medical, financial, employment, account");
    expect(prompt).toContain("allowed only when it is an entity in the selected proposition");
  });

  it("separates human check-worthiness from retrieval-plan generation", () => {
    const system = preselectedInvestigationPlannerSystemPrompt("en");
    const user = preselectedInvestigationPlannerUserPrompt("Approved exact claim.", "Page context with Approved exact claim.");
    expect(system).toContain("independent human annotation");
    expect(system).toContain("do not select a different claim");
    expect(user).toContain("<APPROVED_CLAIM>");
    expect(user).toContain("<SOURCE_CONTEXT>");
  });

  it("can replace the exact span only for a human-preselected atomic claim", () => {
    const parsed = parseInvestigationPlanDraftContent(JSON.stringify(eligibleDraft))!;
    const result = materializeHumanPreselectedAtomicPlan(parsed, {
      sampleId: "syn_human_atomic",
      scope: "page",
      sourceText: eligibleDraft.subject.originalSpan,
      contentFingerprint: "0123456789abcdef0123456789abcdef",
      observedAt: "2026-07-14T02:00:00Z",
    }, eligibleDraft.subject.originalSpan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.subject.proposition.originalSpan).toBe(eligibleDraft.subject.originalSpan);
      expect(result.bundle.plan.questions).toHaveLength(1);
    }
  });

  it("rejects the legacy multi-proposition shape and obvious compound clauses", () => {
    const legacy = structuredClone(eligibleDraft) as any;
    legacy.subject.propositions = [legacy.subject.proposition];
    delete legacy.subject.proposition;
    expect(parseInvestigationPlanDraftContent(JSON.stringify(legacy))).toBeUndefined();

    const compound = structuredClone(eligibleDraft);
    compound.subject.originalSpan = "Example Agency announced 232 products, and every retailer stopped sales.";
    compound.subject.normalizedClaim = compound.subject.originalSpan;
    compound.subject.proposition.originalSpan = compound.subject.originalSpan;
    compound.subject.proposition.normalizedText = compound.subject.originalSpan;
    const result = materializeInvestigationPlan(
      parseInvestigationPlanDraftContent(JSON.stringify(compound))!,
      {
        sampleId: "syn_compound",
        scope: "page",
        sourceText: compound.subject.originalSpan,
        contentFingerprint: "0123456789abcdef0123456789abcdef",
        observedAt: "2026-07-14T02:00:00Z",
      },
    );
    expect(result).toMatchObject({ ok: false, error: "compound_proposition", detail: "coordinated_clauses" });
    expect(detectCompoundPropositionSignal("Production fell from 120 to 90 units in June.")).toBeUndefined();
    expect(detectCompoundPropositionSignal("雙方已達成共識，雙方將加強執法合作。"))
      .toBe("new_clause_after_comma");
    expect(detectCompoundPropositionSignal("她宣稱推薦顏某加入組織，此說法是謊言。"))
      .toBe("claim_plus_truth_judgment");
    expect(detectCompoundPropositionSignal("她宣稱推薦顏某加入組織的說法是謊言"))
      .toBe("claim_plus_truth_judgment");

    const privateRecords = structuredClone(eligibleDraft);
    privateRecords.plan.questions[0].queryCandidates = ["Lisa Faulkner medical records"];
    expect(parseInvestigationPlanDraftContent(JSON.stringify(privateRecords))).toBeUndefined();
  });
});
