export function classifyGeneralPageAuditMockRequest(systemText, hasImageUrl = false) {
  if (/parser recovery classifier/i.test(systemText)) return "parser-advisor";
  if (/final (?:binary )?admission(?: and tier-correction)? critic for one optional reader-facing fact-check action/i.test(systemText)) {
    return "investigation-admission";
  }
  if (
    /prepare (?:one|a bounded batch of) candidate fact-check action/i.test(systemText) ||
    /Select zero to three investigation actions from a fixed list/i.test(systemText) ||
    /Select zero or one reader-facing fact-check action from a fixed list of exact Page spans/i.test(systemText)
  ) return "investigation-adapter";
  if (hasImageUrl) return "screenshot-brief";
  if (/dominant color/i.test(systemText)) return "vision-probe";
  return "brief";
}
