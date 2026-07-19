export function isSupportedScreenshotDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim());
}
