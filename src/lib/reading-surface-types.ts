export type ReadingSurfaceKind = "social-post" | "web-page";

export type ReadingSurfaceSource = "facebook" | "general" | "threads";

export type ReadingSurfaceExtractionMethod =
  | "semantic-html"
  | "readability-heuristic"
  | "selection"
  | "fallback";

export type ReadingExtractionStatus = "complete" | "partial" | "empty" | "blocked";

export type ReadingExtractionWarning =
  | "no-main-content"
  | "selection-only"
  | "very-short-content"
  | "large-navigation-noise"
  | "login-or-paywall-like"
  | "dynamic-content-partial"
  | "unavailable-page"
  | "truncated-content-preview";

export interface ReadingSurfaceLink {
  href: string;
  text?: string;
}

export interface ReadingSurfaceImage {
  src: string;
  alt?: string;
  title?: string;
}

export interface ReadingSurfaceExtraction {
  method: ReadingSurfaceExtractionMethod;
  status: ReadingExtractionStatus;
  warnings: ReadingExtractionWarning[];
}

export interface ReadingSurface {
  id: string;
  kind: ReadingSurfaceKind;
  source: ReadingSurfaceSource;
  url: string;
  canonicalUrl?: string;
  title?: string;
  authorName?: string;
  sourceName?: string;
  publishedAt?: string;
  mainText: string;
  selectedText?: string;
  excerpt?: string;
  links?: ReadingSurfaceLink[];
  images?: ReadingSurfaceImage[];
  extraction: ReadingSurfaceExtraction;
}
