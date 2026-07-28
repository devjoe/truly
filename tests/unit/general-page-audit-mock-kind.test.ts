import { describe, expect, it } from "vitest";

import { buildGeneralPageInvestigationActionAdmissionSystemPrompt } from "@src/lib/general-page-investigation-action-admission";
import { buildGeneralPageInvestigationSpanAdapterSystemPrompt } from "@src/lib/general-page-investigation-span-adapter";
import { classifyGeneralPageAuditMockRequest } from "../../scripts/lib/general-page-audit-mock-kind.mjs";

describe("General Page audit mock routing", () => {
  it("keeps the selector and admission critic distinct without coupling routing to schema versions", () => {
    expect(classifyGeneralPageAuditMockRequest(
      buildGeneralPageInvestigationSpanAdapterSystemPrompt(),
    )).toBe("investigation-adapter");
    expect(classifyGeneralPageAuditMockRequest(
      buildGeneralPageInvestigationActionAdmissionSystemPrompt(),
    )).toBe("investigation-admission");
  });

  it("keeps parser, screenshot, vision, and ordinary brief requests distinct", () => {
    expect(classifyGeneralPageAuditMockRequest("You are a parser recovery classifier.")).toBe("parser-advisor");
    expect(classifyGeneralPageAuditMockRequest("Summarize the page.", true)).toBe("screenshot-brief");
    expect(classifyGeneralPageAuditMockRequest("Report the dominant color.")).toBe("vision-probe");
    expect(classifyGeneralPageAuditMockRequest("Summarize the page.")).toBe("brief");
  });
});
