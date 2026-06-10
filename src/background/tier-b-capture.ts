import { buildTierBDeepChatBody, type TierBChatBody } from "../lib/tier-b-client";

export type TierBCaptureSource = "expand" | "manual" | "auto";

export type TierBCaptureInput = {
  postId: string;
  endpoint: string;
  model: string;
  text: string;
  imageUrls: string[];
  filteredImageCount?: number;
  source?: TierBCaptureSource;
};

export type TierBCaptureItem = {
  ts: number;
  postId: string;
  endpoint: string;
  model: string;
  source?: TierBCaptureSource;
  text: string;
  imageUrls: string[];
  filteredImageCount?: number;
  chatBody: TierBChatBody;
};

export type TierBCaptureBuffer = {
  enabled: boolean;
  maxItems: number;
  items: TierBCaptureItem[];
};

export function createTierBCaptureBuffer(maxItems = 60): TierBCaptureBuffer {
  return {
    enabled: false,
    maxItems,
    items: [],
  };
}

export function maybeCaptureTierB(
  capture: TierBCaptureBuffer,
  message: TierBCaptureInput,
  now = Date.now(),
): void {
  if (!capture.enabled) return;
  const item: TierBCaptureItem = {
    ts: now,
    postId: message.postId,
    endpoint: message.endpoint,
    model: message.model,
    source: message.source,
    text: message.text,
    imageUrls: message.imageUrls,
    filteredImageCount: message.filteredImageCount,
    chatBody: buildTierBDeepChatBody({
      endpoint: message.endpoint,
      model: message.model,
      text: message.text,
      imageUrls: message.imageUrls,
      filteredImageCount: message.filteredImageCount,
    }),
  };
  capture.items.push(item);
  if (capture.items.length > capture.maxItems) {
    capture.items.splice(0, capture.items.length - capture.maxItems);
  }
}
