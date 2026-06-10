export interface SyncAnalysisReferenceOpenStateOptions {
  analysisPaneEl: HTMLElement;
  postId: string | null;
  referenceSectionOpenIds: Set<string>;
  escapeCss?: (value: string) => string;
}

function defaultEscapeCss(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value;
}

export function syncAnalysisReferenceOpenState({
  analysisPaneEl,
  postId,
  referenceSectionOpenIds,
  escapeCss = defaultEscapeCss,
}: SyncAnalysisReferenceOpenStateOptions): void {
  if (!postId) return;
  const openReference = analysisPaneEl.querySelector<HTMLDetailsElement>(
    `.analysis-card[data-truly-dash-id="${escapeCss(postId)}"] .reference-section`,
  );
  if (openReference?.open) {
    referenceSectionOpenIds.add(postId);
  } else if (openReference) {
    referenceSectionOpenIds.delete(postId);
  }
}
