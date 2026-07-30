export function classifyGeneralPageAuditMockRequest(systemText, hasImageUrl = false) {
  if (/parser recovery classifier/i.test(systemText)) return "parser-advisor";
  if (/Classify the investigation utility of one exact Page proposition/i.test(systemText)) {
    return "investigation-tier";
  }
  if (/final admission critic for one optional reader-facing fact-check action/i.test(systemText)) {
    return "investigation-admission";
  }
  if (
    /prepare (?:one|a bounded batch of) candidate fact-check action/i.test(systemText) ||
    /Select zero to three investigation actions from a fixed list/i.test(systemText) ||
    /Choose zero to three reader-worthy verification actions from a nonempty fixed list of exact Page spans/i.test(systemText) ||
    /Rank up to three internal fact-check candidates from a nonempty fixed list of exact Page spans/i.test(systemText)
  ) return "investigation-adapter";
  if (hasImageUrl) return "screenshot-brief";
  if (/dominant color/i.test(systemText)) return "vision-probe";
  return "brief";
}
