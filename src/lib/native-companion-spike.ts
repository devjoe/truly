import type { InvestigationBundle } from "./claim-investigation-contract";
import {
  NATIVE_COMPANION_PROTOCOL_VERSION,
  parseNativeCompanionRequest,
  type NativeCompanionRequest,
  type NativeCompanionResponse,
} from "./native-companion-contract";

/** Product envelope limit; intentionally below Chrome's 1 MB native-host
 * response ceiling so framing overhead and future fields have headroom. */
export const NATIVE_COMPANION_ENVELOPE_LIMIT_BYTES = 256 * 1024;

export interface SyntheticCompanionWorkspace {
  workspaceId: string;
  bundle: InvestigationBundle;
  state: "queued" | "cancelled";
  checkpoint: string;
  updatedAt: string;
}

export interface SyntheticCompanionStore {
  get(subjectId: string): SyntheticCompanionWorkspace | undefined;
  set(subjectId: string, workspace: SyntheticCompanionWorkspace): void;
  delete(subjectId: string): void;
}

export class MemorySyntheticCompanionStore implements SyntheticCompanionStore {
  readonly workspaces = new Map<string, SyntheticCompanionWorkspace>();
  get(subjectId: string) { return this.workspaces.get(subjectId); }
  set(subjectId: string, workspace: SyntheticCompanionWorkspace) { this.workspaces.set(subjectId, workspace); }
  delete(subjectId: string) { this.workspaces.delete(subjectId); }
}

function error(requestId: string, code: "invalid_request" | "not_found", message: string): NativeCompanionResponse {
  return { version: 1, requestId, ok: false, type: "error", error: { code, message } };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Synthetic host used only to prove the transport boundary. It performs no
 * network retrieval and stores no real page data in release runtime.
 */
export class SyntheticNativeCompanionHost {
  constructor(private readonly store: SyntheticCompanionStore) {}

  handle(value: unknown): NativeCompanionResponse {
    const fallbackId = typeof (value as { requestId?: unknown })?.requestId === "string"
      ? (value as { requestId: string }).requestId
      : "invalid-request";
    if (byteLength(value) > NATIVE_COMPANION_ENVELOPE_LIMIT_BYTES) {
      return error(fallbackId, "invalid_request", "Envelope exceeds the product limit");
    }
    const request = parseNativeCompanionRequest(value);
    if (!request) return error(fallbackId, "invalid_request", "Request failed contract validation");
    return this.handleValid(request);
  }

  private handleValid(request: NativeCompanionRequest): NativeCompanionResponse {
    if (request.type === "capabilities.get") {
      return {
        version: NATIVE_COMPANION_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        type: "capabilities.result",
        payload: {
          protocolVersions: [NATIVE_COMPANION_PROTOCOL_VERSION],
          capabilities: ["durable_workspace", "resumable_retrieval", "local_evidence_ledger"],
        },
      };
    }
    if (request.type === "investigation.start") {
      const existing = this.store.get(request.payload.subject.id);
      if (existing) {
        return {
          version: 1,
          requestId: request.requestId,
          ok: true,
          type: "investigation.accepted",
          payload: { subjectId: request.payload.subject.id, workspaceId: existing.workspaceId },
        };
      }
      const workspaceId = `workspace:${request.payload.subject.id}`;
      this.store.set(request.payload.subject.id, {
        workspaceId,
        bundle: { subject: request.payload.subject, plan: request.payload.plan, evidence: [] },
        state: "queued",
        checkpoint: "accepted",
        updatedAt: request.payload.consent.grantedAt,
      });
      return {
        version: 1,
        requestId: request.requestId,
        ok: true,
        type: "investigation.accepted",
        payload: { subjectId: request.payload.subject.id, workspaceId },
      };
    }
    const subjectId = request.payload.subjectId;
    const workspace = this.store.get(subjectId);
    if (!workspace) return error(request.requestId, "not_found", "Investigation workspace was not found");
    if (request.type === "investigation.status") {
      return {
        version: 1,
        requestId: request.requestId,
        ok: true,
        type: "investigation.status.result",
        payload: {
          subjectId,
          workspaceId: workspace.workspaceId,
          state: workspace.state,
          checkpoint: workspace.checkpoint,
          updatedAt: workspace.updatedAt,
        },
      };
    }
    if (request.type === "investigation.cancel") {
      this.store.set(subjectId, { ...workspace, state: "cancelled", checkpoint: "cancelled", updatedAt: new Date().toISOString() });
      return { version: 1, requestId: request.requestId, ok: true, type: "investigation.cancelled", payload: { subjectId } };
    }
    if (request.type === "investigation.delete") {
      this.store.delete(subjectId);
      return { version: 1, requestId: request.requestId, ok: true, type: "investigation.deleted", payload: { subjectId } };
    }
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      type: "investigation.snapshot.result",
      payload: { bundle: workspace.bundle },
    };
  }
}
