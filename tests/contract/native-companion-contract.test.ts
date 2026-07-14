import { describe, expect, it } from "vitest";
import fixture from "../fixtures/claim-investigation/food-recall-contract.json";
import {
  parseNativeCompanionRequest,
  parseNativeCompanionResponse,
} from "../../src/lib/native-companion-contract";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";

const bundle = fixture as InvestigationBundle;

describe("synthetic native companion protocol", () => {
  it("requires per-investigation consent before accepting source material", () => {
    const request = {
      version: 1,
      requestId: "request:1",
      type: "investigation.start",
      payload: {
        subject: bundle.subject,
        plan: bundle.plan,
        consent: { grantedAt: "2026-07-14T03:00:00Z", scope: "this_investigation" },
      },
    };
    expect(parseNativeCompanionRequest(request)?.type).toBe("investigation.start");
    expect(parseNativeCompanionRequest({ ...request, payload: { ...request.payload, consent: undefined } })).toBeUndefined();
  });

  it("accepts a valid evidence snapshot and rejects broken bundles", () => {
    const response = {
      version: 1,
      requestId: "request:2",
      ok: true,
      type: "investigation.snapshot.result",
      payload: { bundle },
    };
    expect(parseNativeCompanionResponse(response)?.type).toBe("investigation.snapshot.result");
    const invalid = structuredClone(bundle);
    invalid.plan.subjectId = "subject:other";
    expect(parseNativeCompanionResponse({ ...response, payload: { bundle: invalid } })).toBeUndefined();
  });

  it("keeps capability discovery free of page content", () => {
    const request = { version: 1, requestId: "request:3", type: "capabilities.get" };
    expect(parseNativeCompanionRequest(request)).toEqual(request);
  });
});
