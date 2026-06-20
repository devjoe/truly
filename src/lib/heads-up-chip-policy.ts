function normalizeChipText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function shouldRenderPersonalContextChip(headline: string, personalLabel: string): boolean {
  const normalizedPersonal = normalizeChipText(personalLabel);
  if (!normalizedPersonal) return false;

  const headlineParts = headline.split("｜").map(normalizeChipText).filter(Boolean);
  if (headlineParts.length === 0) return true;

  return !headlineParts.includes(normalizedPersonal);
}
