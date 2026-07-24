import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/claim-investigation/food-recall-contract.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import { evidenceFirstInvestigationHtml } from "../../scripts/lib/evidence-first-investigation-renderer";

describe("evidence-first investigation renderer", () => {
  it("renders excerpts before sufficiency and the bounded synthesis", () => {
    const dom = new JSDOM(evidenceFirstInvestigationHtml(fixture as InvestigationBundle));
    const root = dom.window.document.querySelector(".evidence-first-investigation");
    const order = [...(root?.querySelectorAll(".investigation-evidence-card,.investigation-sufficiency,.investigation-finding") ?? [])]
      .map((element) => element.className);
    expect(order.at(0)).toBe("investigation-evidence-card");
    expect(order.at(-2)).toBe("investigation-sufficiency");
    expect(order.at(-1)).toBe("investigation-finding");
    expect(root?.textContent).toContain("1 個問題尚未回答");
    expect(root?.textContent).not.toContain("真假");
  });

  it("renders an explicit empty-evidence state without inventing a result", () => {
    const planned = structuredClone(fixture) as InvestigationBundle;
    planned.evidence = [];
    delete planned.sufficiency;
    delete planned.finding;
    const html = evidenceFirstInvestigationHtml(planned);
    expect(html).toContain("尚未找到可回答這個問題的證據");
    expect(html).not.toContain("investigation-finding");
  });
});
