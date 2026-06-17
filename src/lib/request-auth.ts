export function bearerTokenHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function jsonRequestHeaders(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...bearerTokenHeaders(apiKey),
  };
}
