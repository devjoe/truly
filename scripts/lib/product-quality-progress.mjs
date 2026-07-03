export function createProductQualityProgressTracker({
  total,
  every,
  log = console.error,
  now = () => Date.now(),
} = {}) {
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  const interval = Number.isInteger(every) && every > 0 ? every : 0;
  const startedAt = now();
  const state = {
    completed: 0,
    extracted: 0,
    emptyOrBlocked: 0,
    fetchErrors: 0,
    readiness: {},
  };

  return {
    record(result) {
      state.completed += 1;
      if (result?.ok) {
        state.extracted += 1;
      } else if (result?.surface) {
        state.emptyOrBlocked += 1;
      }
      if (result?.errorKind) {
        state.fetchErrors += 1;
      }

      const readiness = result?.modelContext?.modelReadiness ?? (result?.errorKind ? "error" : "unknown");
      state.readiness[readiness] = (state.readiness[readiness] ?? 0) + 1;

      if (!shouldLogProgress(state.completed, safeTotal, interval)) return;
      log(renderProductQualityProgressLine({
        ...state,
        total: safeTotal,
        elapsedMs: Math.max(0, now() - startedAt),
      }));
    },
  };
}

export function renderProductQualityProgressLine({
  completed,
  total,
  extracted,
  emptyOrBlocked,
  fetchErrors,
  readiness,
  elapsedMs,
}) {
  return [
    "[general-page-review]",
    `progress ${completed}/${total}`,
    `extracted ${extracted}`,
    `emptyOrBlocked ${emptyOrBlocked}`,
    `fetchErrors ${fetchErrors}`,
    `elapsed ${Math.round((elapsedMs ?? 0) / 1000)}s`,
    `readiness ${JSON.stringify(readiness ?? {})}`,
  ].join(" ");
}

function shouldLogProgress(completed, total, every) {
  if (!every) return false;
  return completed === total || completed % every === 0;
}
