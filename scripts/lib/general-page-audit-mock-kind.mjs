export function classifyGeneralPageAuditMockRequest(systemText, hasImageUrl = false) {
  if (/parser recovery classifier/i.test(systemText)) return "parser-advisor";
  if (
    /prepare (?:one|a bounded batch of) candidate fact-check action/i.test(systemText) ||
    /Select zero to three investigation actions from a fixed list/i.test(systemText) ||
    /Choose zero or one recommended investigation action from a fixed list of exact source spans/i.test(systemText)
  ) return "investigation-adapter";
  if (hasImageUrl) return "screenshot-brief";
  if (/dominant color/i.test(systemText)) return "vision-probe";
  return "brief";
}
