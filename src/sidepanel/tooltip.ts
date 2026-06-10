// Singleton tooltip controller.
// Pseudo-element tooltips get clipped when a trigger sits near the side
// panel's left/right edge. A JS-positioned fixed element can clamp to
// the viewport on both axes.

let tooltipEl: HTMLElement | null = null;
let tooltipTarget: HTMLElement | null = null;
let tooltipSuppressUntil = 0;

function positionTooltip(target: HTMLElement): void {
  if (!tooltipEl) return;
  if (Date.now() < tooltipSuppressUntil) return;
  const text = target.dataset.tooltip || "";
  if (!text) return;
  tooltipEl.textContent = text;
  tooltipEl.classList.add("visible");

  const rect = target.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();
  const margin = 6;
  const gap = 6;

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  const maxLeft = window.innerWidth - tipRect.width - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  let top = rect.top - tipRect.height - gap;
  if (top < margin) top = rect.bottom + gap;

  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
}

export function hideTooltip(): void {
  if (!tooltipEl) return;
  tooltipEl.classList.remove("visible");
  tooltipTarget = null;
}

export function suppressTooltip(ms = 1200): void {
  tooltipSuppressUntil = Date.now() + ms;
  hideTooltip();
}

/** Wire the singleton tooltip element + document listeners. Call once after
 *  the sidepanel DOM is available. */
export function installTooltips(): void {
  tooltipEl = document.getElementById("truly-tooltip") as HTMLElement;

  document.addEventListener("mouseover", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.(
      "[data-tooltip]"
    ) as HTMLElement | null;
    if (!target || target === tooltipTarget) return;
    tooltipTarget = target;
    positionTooltip(target);
  });

  document.addEventListener("mouseout", (e) => {
    if (!tooltipTarget) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && tooltipTarget.contains(related)) return;
    hideTooltip();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest?.("[data-tooltip]");
      if (target) suppressTooltip();
    },
    true,
  );

  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("blur", hideTooltip);
}
