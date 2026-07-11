import { writeFileSync } from "node:fs";

export const WEB_FOCUS_CONTINUITY_ARTIFACTS = Object.freeze({
  activation: "page-focus-activation.json",
  focusReadyTimeout: "page-focus-ready-timeout",
  history: "page-web-history-hidden",
  selectionTimeout: "page-selection-timeout.png",
  selection: "page-selection-target.png",
  webRestored: "page-web-restored-after-focus.png",
  focusRestored: "page-focus-restored-after-web.png",
});

export async function runWebFocusContinuityScenario({
  side,
  article,
  waitFor,
  artifactPath,
}) {
  await waitFor(side, `(() => Boolean(document.querySelector('#page-pane .page-reader-analysis:not(.is-running) .page-reader-analysis-summary')))()`, 20_000, "Web analysis before Focus switch");
  const webBeforeFocus = await side.evaluateJson(`(() => ({
    documentHasFocus: document.hasFocus(),
    summary: document.querySelector('#page-pane .page-reader-analysis-summary')?.textContent?.trim() || null,
    activeState: globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null,
  }))()`);
  await waitFor(side, `(() => document.querySelector('.tab[data-tab="focus"]')?.getAttribute('aria-disabled') !== 'true')()`, 4000, "Web Focus tab available");
  await side.evaluate(`document.querySelector('.tab[data-tab="focus"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
  const focusActivationState = await side.evaluateJson(`(() => ({
    activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim() || null,
    selectionButton: Boolean(document.querySelector('#pageReadSelection')),
    paneText: document.querySelector('#page-pane')?.innerText || '',
    runtime: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
  }))()`);
  writeFileSync(artifactPath(WEB_FOCUS_CONTINUITY_ARTIFACTS.activation), JSON.stringify(focusActivationState, null, 2));
  await waitFor(side, `(() => document.querySelector('#pageReadSelection')?.disabled === false)()`, 4000, "Web focus selection action enabled on current page").catch(async (error) => {
    const timeoutState = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim() || null,
      focusAvailability: document.querySelector('.tab[data-tab="focus"]')?.getAttribute('aria-disabled'),
      selectionButton: (() => {
        const button = document.querySelector('#pageReadSelection');
        return button ? { text: button.textContent?.trim(), disabled: button.disabled } : null;
      })(),
      paneText: document.querySelector('#page-pane')?.innerText || '',
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
    }))()`);
    writeFileSync(artifactPath(`${WEB_FOCUS_CONTINUITY_ARTIFACTS.focusReadyTimeout}.json`), JSON.stringify(timeoutState, null, 2));
    await side.screenshot(artifactPath(`${WEB_FOCUS_CONTINUITY_ARTIFACTS.focusReadyTimeout}.png`)).catch(() => {});
    throw error;
  });

  const historyDisplay = await side.evaluateJson(`(() => {
    const base = globalThis.__trulyHistoryDisplayAudit || {};
    return {
      ...base,
      text: document.querySelector('#page-pane')?.innerText || '',
      sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
      switcherVisible: Boolean(document.querySelector('.page-reader-switcher')),
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      readCurrentVisible: Boolean(document.querySelector('#pageReadCurrent:not([hidden])')),
      hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    };
  })()`);
  writeFileSync(artifactPath(`${WEB_FOCUS_CONTINUITY_ARTIFACTS.history}.json`), JSON.stringify(historyDisplay, null, 2));
  await side.screenshot(artifactPath(`${WEB_FOCUS_CONTINUITY_ARTIFACTS.history}.png`)).catch(() => {});

  const selectedText = await article.evaluate(`(() => {
    const paragraph = document.querySelector('article p:nth-of-type(3)');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString().replace(/\\s+/g, ' ').trim();
  })()`);
  const selectionBeforeAction = await side.evaluateJson(`(() => {
    const pane = document.querySelector('#page-pane');
    const model = pane?.querySelector('.page-reader-processing-status') || pane?.querySelector('.page-reader-model-context');
    const rows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
      label: row.querySelector('dt')?.textContent?.trim(),
      value: row.querySelector('dd')?.textContent?.trim(),
      rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
    }));
    const activeState = globalThis.__trulyPageReadingRuntime?.auditState?.() || null;
    return {
      excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      targetKind: activeState?.displayedSession?.targetKind ||
        rows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.rawValue ||
        null,
      pipelineHidden: !model && !pane?.querySelector('.page-reader-advisor'),
      activeState,
    };
  })()`);
  await side.evaluate(`document.querySelector('#pageReadSelection')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
  await waitFor(side, `(() => {
    const activeState = globalThis.__trulyPageReadingRuntime?.auditState?.() || null;
    if (activeState?.displayedSession?.targetKind === 'selection') return true;
    const model = document.querySelector('#page-pane .page-reader-processing-status') || document.querySelector('#page-pane .page-reader-model-context');
    const rows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
      label: row.querySelector('dt')?.textContent?.trim(),
      value: row.querySelector('dd')?.textContent?.trim(),
      rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
    }));
    return rows.some((row) => /targetKind|目標|Target/.test(row.label || '') && (row.rawValue || row.value) === 'selection');
  })()`, 10_000, "Web selection target").catch(async (error) => {
    await side.screenshot(artifactPath(WEB_FOCUS_CONTINUITY_ARTIFACTS.selectionTimeout)).catch(() => {});
    throw error;
  });
  const selection = await side.evaluateJson(`(() => {
    const pane = document.querySelector('#page-pane');
    const model = pane?.querySelector('.page-reader-processing-status') || pane?.querySelector('.page-reader-model-context');
    const advisor = pane?.querySelector('.page-reader-processing-status') || pane?.querySelector('.page-reader-advisor');
    return {
      excerpt: pane?.querySelector('.page-reader-focus-preview')?.textContent?.trim(),
      focusPanelCount: pane?.querySelectorAll('.page-reader-focus-panel').length || 0,
      hasPageCard: Boolean(pane?.querySelector('.page-reader-card')),
      analysisTitle: pane?.querySelector('.page-reader-focus-analysis .page-reader-analysis-header h3')?.textContent?.trim(),
      hasLastRead: /上次讀取|Last read/.test(pane?.innerText || ''),
      hasExternalToolsLabel: /外部工具整合|External Tool Integration/.test(pane?.innerText || ''),
      focusToolCount: pane?.querySelectorAll('.page-reader-focus-tools .page-reader-card-action').length || 0,
      modelRows: [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      })),
      advisorRows: [...advisor?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      })),
      advisorStatus: advisor?.querySelector('.page-reader-processing-status-header span, .page-reader-advisor-header span')?.textContent?.trim(),
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
    };
  })()`);
  await side.screenshot(artifactPath(WEB_FOCUS_CONTINUITY_ARTIFACTS.selection));

  await waitFor(side, `(() => Boolean(document.querySelector('#page-pane .page-reader-focus-analysis .page-reader-analysis:not(.is-running) .page-reader-analysis-summary')))()`, 20_000, "Focus analysis before Web switch");
  const focusBeforeWeb = await side.evaluateJson(`(() => {
    const pane = document.querySelector('#page-pane');
    const heading = pane?.querySelector('.page-reader-focus-analysis .page-reader-analysis-header h3');
    const reference = pane?.querySelector('.page-reader-analysis h4');
    const headingStyle = heading ? getComputedStyle(heading) : null;
    const referenceStyle = reference ? getComputedStyle(reference) : null;
    return {
      documentHasFocus: document.hasFocus(),
      summary: pane?.querySelector('.page-reader-analysis-summary')?.textContent?.trim() || null,
      updateButtonText: pane?.querySelector('#pageReadSelection')?.textContent?.trim() || null,
      headingStyle: headingStyle ? {
        color: headingStyle.color,
        fontSize: headingStyle.fontSize,
        fontWeight: headingStyle.fontWeight,
      } : null,
      referenceStyle: referenceStyle ? {
        color: referenceStyle.color,
        fontSize: referenceStyle.fontSize,
        fontWeight: referenceStyle.fontWeight,
      } : null,
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null,
    };
  })()`);
  await side.evaluate(`document.querySelector('.tab[data-tab="page"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
  await waitFor(side, `(() => Boolean(document.querySelector('#page-pane .page-reader-analysis:not(.is-running) .page-reader-analysis-summary')))()`, 8000, "restored Web analysis");
  const webAfterFocus = await side.evaluateJson(`(() => ({
    documentHasFocus: document.hasFocus(),
    summary: document.querySelector('#page-pane .page-reader-analysis-summary')?.textContent?.trim() || null,
    activeState: globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null,
  }))()`);
  await side.screenshot(artifactPath(WEB_FOCUS_CONTINUITY_ARTIFACTS.webRestored));
  await side.evaluate(`document.querySelector('.tab[data-tab="focus"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
  await waitFor(side, `(() => Boolean(document.querySelector('#page-pane .page-reader-focus-analysis .page-reader-analysis:not(.is-running) .page-reader-analysis-summary')))()`, 8000, "restored Focus analysis");
  const focusAfterWeb = await side.evaluateJson(`(() => ({
    documentHasFocus: document.hasFocus(),
    summary: document.querySelector('#page-pane .page-reader-analysis-summary')?.textContent?.trim() || null,
    activeState: globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null,
  }))()`);
  await side.screenshot(artifactPath(WEB_FOCUS_CONTINUITY_ARTIFACTS.focusRestored));

  return {
    historyDisplay,
    selection: { selectedText, beforeAction: selectionBeforeAction, ...selection },
    continuity: { webBeforeFocus, focusBeforeWeb, webAfterFocus, focusAfterWeb },
  };
}

export function assertWebFocusContinuity({ selection, continuity }) {
  const errors = [];
  const focus = continuity?.focusBeforeWeb;
  const focusStates = [
    continuity?.webBeforeFocus,
    continuity?.focusBeforeWeb,
    continuity?.webAfterFocus,
    continuity?.focusAfterWeb,
  ];
  if (selection?.focusPanelCount !== 1 || selection?.hasPageCard !== false) {
    errors.push("Focus did not preserve the single-card target-centric information architecture");
  }
  if (!continuity?.webBeforeFocus?.summary || continuity.webAfterFocus?.summary !== continuity.webBeforeFocus.summary) {
    errors.push("Web analysis was not preserved across the Focus switch");
  }
  if (!focus?.summary || continuity.focusAfterWeb?.summary !== focus.summary) {
    errors.push("Focus analysis was not preserved across the Web switch");
  }
  if (continuity?.webBeforeFocus?.summary === focus?.summary) {
    errors.push("deterministic Web and Focus summaries were not distinct");
  }
  if (JSON.stringify(focus?.headingStyle) !== JSON.stringify(focus?.referenceStyle)) {
    errors.push("Focus overview typography does not match the subsection hierarchy");
  }
  if (!/^(套用選取內容|Apply selected content)$/.test(focus?.updateButtonText || "")) {
    errors.push(`unexpected Focus action copy: ${focus?.updateButtonText || "(missing)"}`);
  }
  if (focusStates.some((state) => state?.documentHasFocus !== false)) {
    errors.push("background CDP UI check unexpectedly focused its Side Panel target");
  }
  return errors;
}

export function webFocusContinuitySummary(continuity) {
  const focus = continuity?.focusBeforeWeb;
  return {
    webPreserved: continuity?.webAfterFocus?.summary === continuity?.webBeforeFocus?.summary,
    focusPreserved: continuity?.focusAfterWeb?.summary === focus?.summary,
    typographyAligned: JSON.stringify(focus?.headingStyle) === JSON.stringify(focus?.referenceStyle),
    focusAction: focus?.updateButtonText || "(missing)",
    documentFocusStates: [
      continuity?.webBeforeFocus,
      continuity?.focusBeforeWeb,
      continuity?.webAfterFocus,
      continuity?.focusAfterWeb,
    ].map((state) => String(state?.documentHasFocus)),
  };
}
