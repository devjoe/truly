import type { InvestigationBundle, InvestigationPlan, InvestigationSubject } from "./claim-investigation-contract";
import { validateInvestigationBundle } from "./claim-investigation-contract";

export const NATIVE_COMPANION_PROTOCOL_VERSION = 1 as const;

export type NativeCompanionRequest =
  | {
      version: 1;
      requestId: string;
      type: "capabilities.get";
    }
  | {
      version: 1;
      requestId: string;
      type: "investigation.start";
      payload: {
        subject: InvestigationSubject;
        plan: InvestigationPlan;
        consent: { grantedAt: string; scope: "this_investigation" };
      };
    }
  | {
      version: 1;
      requestId: string;
      type: "investigation.snapshot";
      payload: { subjectId: string };
    }
  | {
      version: 1;
      requestId: string;
      type: "investigation.status";
      payload: { subjectId: string };
    }
  | {
      version: 1;
      requestId: string;
      type: "investigation.cancel";
      payload: { subjectId: string };
    }
  | {
      version: 1;
      requestId: string;
      type: "investigation.delete";
      payload: { subjectId: string };
    };

export type NativeCompanionResponse =
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "capabilities.result";
      payload: {
        protocolVersions: number[];
        capabilities: Array<"durable_workspace" | "resumable_retrieval" | "local_evidence_ledger">;
      };
    }
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "investigation.accepted";
      payload: { subjectId: string; workspaceId: string };
    }
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "investigation.snapshot.result";
      payload: { bundle: InvestigationBundle };
    }
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "investigation.status.result";
      payload: {
        subjectId: string;
        workspaceId: string;
        state: "queued" | "running" | "paused" | "completed" | "cancelled";
        checkpoint: string;
        updatedAt: string;
      };
    }
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "investigation.cancelled";
      payload: { subjectId: string };
    }
  | {
      version: 1;
      requestId: string;
      ok: true;
      type: "investigation.deleted";
      payload: { subjectId: string };
    }
  | {
      version: 1;
      requestId: string;
      ok: false;
      type: "error";
      error: {
        code: "unsupported_version" | "invalid_request" | "consent_required" | "not_found" | "busy";
        message: string;
      };
    };

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requestBase(value: unknown): Record<string, unknown> | undefined {
  const root = record(value);
  return root?.version === NATIVE_COMPANION_PROTOCOL_VERSION &&
    typeof root.requestId === "string" && ID_RE.test(root.requestId)
    ? root
    : undefined;
}

export function parseNativeCompanionRequest(value: unknown): NativeCompanionRequest | undefined {
  const root = requestBase(value);
  if (!root || typeof root.type !== "string") return undefined;
  if (root.type === "capabilities.get") return root.payload === undefined ? root as NativeCompanionRequest : undefined;
  const payload = record(root.payload);
  if (!payload) return undefined;
  if (["investigation.snapshot", "investigation.status", "investigation.cancel", "investigation.delete"].includes(root.type)) {
    return typeof payload.subjectId === "string" && ID_RE.test(payload.subjectId)
      ? root as NativeCompanionRequest
      : undefined;
  }
  if (root.type !== "investigation.start") return undefined;
  const consent = record(payload.consent);
  if (!consent || consent.scope !== "this_investigation" ||
    typeof consent.grantedAt !== "string" || Number.isNaN(Date.parse(consent.grantedAt))) return undefined;
  const subject = record(payload.subject);
  const plan = record(payload.plan);
  if (!subject || !plan) return undefined;
  const validation = validateInvestigationBundle({
    subject: payload.subject as InvestigationSubject,
    plan: payload.plan as InvestigationPlan,
    evidence: [],
  });
  return validation.ok ? root as NativeCompanionRequest : undefined;
}

export function parseNativeCompanionResponse(value: unknown): NativeCompanionResponse | undefined {
  const root = requestBase(value);
  if (!root || typeof root.ok !== "boolean" || typeof root.type !== "string") return undefined;
  if (!root.ok) {
    const error = record(root.error);
    return root.type === "error" && typeof error?.code === "string" && typeof error.message === "string"
      ? root as NativeCompanionResponse
      : undefined;
  }
  const payload = record(root.payload);
  if (!payload) return undefined;
  if (root.type === "capabilities.result") {
    return Array.isArray(payload.protocolVersions) && Array.isArray(payload.capabilities)
      ? root as NativeCompanionResponse
      : undefined;
  }
  if (root.type === "investigation.accepted") {
    return typeof payload.subjectId === "string" && typeof payload.workspaceId === "string"
      ? root as NativeCompanionResponse
      : undefined;
  }
  if (root.type === "investigation.cancelled" || root.type === "investigation.deleted") {
    return typeof payload.subjectId === "string" ? root as NativeCompanionResponse : undefined;
  }
  if (root.type === "investigation.status.result") {
    return typeof payload.subjectId === "string" && typeof payload.workspaceId === "string" &&
      ["queued", "running", "paused", "completed", "cancelled"].includes(String(payload.state)) &&
      typeof payload.checkpoint === "string" && typeof payload.updatedAt === "string" && !Number.isNaN(Date.parse(payload.updatedAt))
      ? root as NativeCompanionResponse
      : undefined;
  }
  if (root.type === "investigation.snapshot.result") {
    const bundle = record(payload.bundle) as InvestigationBundle | undefined;
    return bundle && validateInvestigationBundle(bundle).ok ? root as NativeCompanionResponse : undefined;
  }
  return undefined;
}
