import type { EvidenceArtifact } from "./claim-investigation-contract";

export const INVESTIGATION_SOURCE_LINEAGE_VERSION = 1 as const;

export type InvestigationSourceDerivation = "original" | "syndicated" | "translated" | "quoted" | "unknown";

export interface InvestigationSourceLineageNode {
  artifactId: string;
  originId: string;
  derivation: InvestigationSourceDerivation;
  derivedFromArtifactId?: string;
}

export interface InvestigationSourceLineageGraph {
  version: typeof INVESTIGATION_SOURCE_LINEAGE_VERSION;
  nodes: InvestigationSourceLineageNode[];
}

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/iu;
const DERIVATIONS = new Set<InvestigationSourceDerivation>(["original", "syndicated", "translated", "quoted", "unknown"]);

export function validateInvestigationSourceLineageGraph(
  graph: InvestigationSourceLineageGraph,
  artifacts: EvidenceArtifact[],
): string[] {
  const issues: string[] = [];
  if (graph.version !== INVESTIGATION_SOURCE_LINEAGE_VERSION || !Array.isArray(graph.nodes)) return ["invalid lineage graph boundary"];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const nodes = new Map<string, InvestigationSourceLineageNode>();
  graph.nodes.forEach((node, index) => {
    if (!artifactIds.has(node.artifactId) || nodes.has(node.artifactId) || !ID_RE.test(node.originId) || !DERIVATIONS.has(node.derivation)) {
      issues.push(`nodes[${index}]: invalid lineage identity`);
      return;
    }
    if (node.derivation === "original" && node.derivedFromArtifactId !== undefined) issues.push(`nodes[${index}]: original source cannot derive from another artifact`);
    if (node.derivation !== "original" && !node.derivedFromArtifactId) issues.push(`nodes[${index}]: derived source requires a parent artifact`);
    nodes.set(node.artifactId, node);
  });
  graph.nodes.forEach((node, index) => {
    if (node.derivedFromArtifactId && !nodes.has(node.derivedFromArtifactId)) issues.push(`nodes[${index}]: unknown parent artifact`);
    const seen = new Set<string>();
    let cursor: InvestigationSourceLineageNode | undefined = node;
    while (cursor?.derivedFromArtifactId) {
      if (seen.has(cursor.artifactId)) { issues.push(`nodes[${index}]: lineage cycle`); break; }
      seen.add(cursor.artifactId);
      cursor = nodes.get(cursor.derivedFromArtifactId);
    }
  });
  return [...new Set(issues)];
}

export function resolveInvestigationOriginId(
  graph: InvestigationSourceLineageGraph,
  artifactId: string,
): string | undefined {
  const nodes = new Map(graph.nodes.map((node) => [node.artifactId, node]));
  let cursor = nodes.get(artifactId);
  if (!cursor) return undefined;
  const seen = new Set<string>();
  while (cursor.derivedFromArtifactId) {
    if (seen.has(cursor.artifactId)) return undefined;
    seen.add(cursor.artifactId);
    const parent = nodes.get(cursor.derivedFromArtifactId);
    if (!parent) return undefined;
    cursor = parent;
  }
  return cursor.originId;
}
