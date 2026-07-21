export function newExternalPageTargets(beforeTargets, afterTargets) {
  const beforeIds = new Set(
    beforeTargets
      .filter(isExternalPageTarget)
      .map((target) => target.id),
  );
  return afterTargets.filter((target) => isExternalPageTarget(target) && !beforeIds.has(target.id));
}

function isExternalPageTarget(target) {
  return target?.type === "page" && /^https?:\/\//i.test(target.url ?? "") && typeof target.id === "string";
}
