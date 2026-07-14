import { describe, expect, it } from "vitest";
import fixture from "../fixtures/claim-investigation/food-recall-contract.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import {
  MemorySyntheticCompanionStore,
  NATIVE_COMPANION_ENVELOPE_LIMIT_BYTES,
  SyntheticNativeCompanionHost,
} from "../../src/lib/native-companion-spike";

const bundle = fixture as InvestigationBundle;
const start = (requestId = "request:start") => ({
  version: 1,
  requestId,
  type: "investigation.start",
  payload: {
    subject: bundle.subject,
    plan: bundle.plan,
    consent: { grantedAt: "2026-07-14T03:00:00Z", scope: "this_investigation" },
  },
});

describe("synthetic native companion host", () => {
  it("negotiates capabilities without content", () => {
    const host = new SyntheticNativeCompanionHost(new MemorySyntheticCompanionStore());
    const response = host.handle({ version: 1, requestId: "request:cap", type: "capabilities.get" });
    expect(response.type).toBe("capabilities.result");
    expect(JSON.stringify(response)).not.toContain(bundle.subject.originalSpan);
  });

  it("is idempotent across retries and host restarts", () => {
    const store = new MemorySyntheticCompanionStore();
    const firstHost = new SyntheticNativeCompanionHost(store);
    const first = firstHost.handle(start());
    const restartedHost = new SyntheticNativeCompanionHost(store);
    const retry = restartedHost.handle(start("request:retry"));
    expect(first.type).toBe("investigation.accepted");
    expect(retry.type).toBe("investigation.accepted");
    if (first.type === "investigation.accepted" && retry.type === "investigation.accepted") {
      expect(retry.payload.workspaceId).toBe(first.payload.workspaceId);
    }
    expect(store.workspaces).toHaveLength(1);
  });

  it("supports resumable status, snapshot, cancellation, and deletion after restart", () => {
    const store = new MemorySyntheticCompanionStore();
    new SyntheticNativeCompanionHost(store).handle(start());
    const host = new SyntheticNativeCompanionHost(store);
    const status = host.handle({ version: 1, requestId: "request:status", type: "investigation.status", payload: { subjectId: bundle.subject.id } });
    expect(status.type).toBe("investigation.status.result");
    if (status.type === "investigation.status.result") expect(status.payload.checkpoint).toBe("accepted");
    const snapshot = host.handle({ version: 1, requestId: "request:snapshot", type: "investigation.snapshot", payload: { subjectId: bundle.subject.id } });
    expect(snapshot.type).toBe("investigation.snapshot.result");
    const cancelled = host.handle({ version: 1, requestId: "request:cancel", type: "investigation.cancel", payload: { subjectId: bundle.subject.id } });
    expect(cancelled.type).toBe("investigation.cancelled");
    expect(store.get(bundle.subject.id)?.state).toBe("cancelled");
    const deleted = host.handle({ version: 1, requestId: "request:delete", type: "investigation.delete", payload: { subjectId: bundle.subject.id } });
    expect(deleted.type).toBe("investigation.deleted");
    expect(store.get(bundle.subject.id)).toBeUndefined();
  });

  it("rejects oversized envelopes before parsing", () => {
    const host = new SyntheticNativeCompanionHost(new MemorySyntheticCompanionStore());
    const response = host.handle({
      version: 1,
      requestId: "request:large",
      type: "capabilities.get",
      padding: "x".repeat(NATIVE_COMPANION_ENVELOPE_LIMIT_BYTES),
    });
    expect(response.type).toBe("error");
    if (response.type === "error") expect(response.error.message).toContain("exceeds");
  });
});
