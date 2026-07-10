import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import {
  initTabs,
  setTabAvailability,
  shouldShowPageReadCurrentAction,
} from "@src/sidepanel/tabs";

describe("sidepanel tab actions", () => {
  it("shows the page read action only on the Web tab", () => {
    expect(shouldShowPageReadCurrentAction("analysis")).toBe(false);
    expect(shouldShowPageReadCurrentAction("page")).toBe(true);
    expect(shouldShowPageReadCurrentAction("focus")).toBe(false);
  });

  it("keeps an unavailable tab visible, explains why, and skips activation", () => {
    const dom = new JSDOM(`<!doctype html>
      <div class="tab-bar">
        <button class="tab" data-tab="analysis">Feed</button>
        <button class="tab" data-tab="page">Web</button>
        <button class="tab" data-tab="focus" data-panel-tab="page">Focus</button>
      </div>
      <section role="tabpanel" data-tab="analysis"></section>
      <section role="tabpanel" data-tab="page"></section>
    `, { url: "https://example.test/sidepanel/sidepanel.html" });
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.sessionStorage = dom.window.sessionStorage;

    const onActivate = vi.fn();
    initTabs(onActivate);
    const reason = "Facebook 內容請在「Feed」分頁查看。";
    const wasSelected = setTabAvailability("page", false, reason);

    const feed = document.querySelector<HTMLButtonElement>("[data-tab='analysis']")!;
    const web = document.querySelector<HTMLButtonElement>("[data-tab='page']")!;
    const focus = document.querySelector<HTMLButtonElement>("[data-tab='focus']")!;
    web.click();

    expect(web.getAttribute("aria-disabled")).toBe("true");
    expect(wasSelected).toBe(false);
    expect(web.dataset.tooltip).toBe(reason);
    expect(web.getAttribute("aria-label")).toContain(reason);
    expect(web.getAttribute("aria-selected")).toBe("false");
    expect(feed.getAttribute("aria-selected")).toBe("true");

    feed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(focus);
    expect(focus.getAttribute("aria-selected")).toBe("true");

    setTabAvailability("page", true);
    expect(web.hasAttribute("aria-disabled")).toBe(false);
    expect(web.hasAttribute("data-tooltip")).toBe(false);
    expect(web.hasAttribute("aria-label")).toBe(false);
  });

  it("reports when the selected tab becomes unavailable", () => {
    const dom = new JSDOM(`<!doctype html>
      <div class="tab-bar">
        <button class="tab" data-tab="analysis">Feed</button>
        <button class="tab" data-tab="page">Web</button>
        <button class="tab" data-tab="focus" data-panel-tab="page">Focus</button>
      </div>
      <section role="tabpanel" data-tab="analysis"></section>
      <section role="tabpanel" data-tab="page"></section>
    `, { url: "https://example.test/sidepanel/sidepanel.html" });
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.sessionStorage = dom.window.sessionStorage;

    const onActivate = vi.fn();
    const activate = initTabs(onActivate);

    expect(setTabAvailability("analysis", false, "Feed unavailable")).toBe(true);
    expect(setTabAvailability("page", false, "Web unavailable")).toBe(false);

    activate("analysis");
    expect(document.querySelector("[data-tab='focus']")?.getAttribute("aria-selected")).toBe("true");
    expect(onActivate).toHaveBeenLastCalledWith("focus");
  });
});
