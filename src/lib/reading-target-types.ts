import type {
  ReadingExtractionStatus,
  ReadingExtractionWarning,
} from "./reading-surface-types";

export type ReadingTargetKind =
  | "selection"
  | "paragraph"
  | "visible-region"
  | "element";

export type ReadingTargetExtractionMethod =
  | "selection"
  | "point-target"
  | "observed-node"
  | "fallback";

export interface ReadingTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReadingTargetExtraction {
  method: ReadingTargetExtractionMethod;
  status: ReadingExtractionStatus;
  warnings: ReadingExtractionWarning[];
}

export interface ReadingTarget {
  id: string;
  surfaceId: string;
  kind: ReadingTargetKind;
  text: string;
  surroundingText?: string;
  sourceRect?: ReadingTargetRect;
  extraction: ReadingTargetExtraction;
}
