import { describe, expect, it } from "vitest";
import { scheduleInvestigationRecovery, shouldStopInvestigationRecovery } from "../../src/lib/investigation-recovery-scheduler";

describe("two-pass recovery scheduler", () => {
  it("gives each case one seed before spending adaptive budget", () => {
    const schedule = scheduleInvestigationRecovery({
      unresolvedObligationIds: ["o:a", "o:b", "o:c"], maxCandidates: 4, maxCandidatesPerCase: 2,
      candidates: [
        { id: "a:weak", caseId: "a", expectedObligationIds: ["o:a"], estimatedAnswerability: 0.4, acquisitionCost: 1, sourceFamily: "news" },
        { id: "a:strong", caseId: "a", expectedObligationIds: ["o:a", "o:b"], estimatedAnswerability: 0.9, acquisitionCost: 1, sourceFamily: "official", originKey: "agency" },
        { id: "b:seed", caseId: "b", expectedObligationIds: ["o:c"], estimatedAnswerability: 0.6, acquisitionCost: 1, sourceFamily: "official", originKey: "other" },
        { id: "a:origin", caseId: "a", expectedObligationIds: ["o:b"], estimatedAnswerability: 0.8, acquisitionCost: 1, sourceFamily: "independent", originKey: "publisher" },
      ],
    });
    expect(schedule.seedCandidateIds).toEqual(["a:strong", "b:seed"]);
    expect(schedule.adaptiveCandidateIds[0]).toBe("a:origin");
  });

  it("stops only after the configured consecutive zero-yield window", () => {
    expect(shouldStopInvestigationRecovery([1, 0], 2)).toBe(false);
    expect(shouldStopInvestigationRecovery([1, 0, 0], 2)).toBe(true);
  });
});
