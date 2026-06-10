export type StructuredPostSegmentKind =
  | "post_text"
  | "sharer_comment"
  | "shared_content"
  | "link_preview"
  | "image_text"
  | "image_alt";

export const STRUCTURED_POST_SEGMENT_LABEL: Record<StructuredPostSegmentKind, string> = {
  post_text: "貼文文字",
  sharer_comment: "分享者評論",
  shared_content: "被分享內容",
  link_preview: "連結預覽",
  image_text: "圖片文字",
  image_alt: "圖片說明（Image Alt）",
};

export interface StructuredPostSegment {
  kind: StructuredPostSegmentKind;
  label: string;
  text: string;
  scanForZhtw: boolean;
}

export interface StructuredPostContext {
  isShare: boolean;
  authorName?: string;
  originalAuthor?: string;
  ownText: string;
  sharerComment: string;
  sharedContent: string;
  linkPreview: string;
  imageTexts: string[];
  imageAltTexts: string[];
  sourceSegments: StructuredPostSegment[];
}
