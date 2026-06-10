export interface LocalePatterns {
  sponsored: string[];
  suggested: string[];
  peopleYouMayKnow: string[];
}

const patterns: Record<string, LocalePatterns> = {
  en: {
    sponsored: ["Sponsored", "Paid partnership"],
    suggested: ["Suggested for you", "Suggested"],
    peopleYouMayKnow: ["People You May Know", "People you may know"],
  },
  zh_TW: {
    sponsored: ["贊助", "付費合作夥伴關係"],
    suggested: ["為你推薦", "推薦"],
    peopleYouMayKnow: ["你可能認識的朋友"],
  },
  ja: {
    sponsored: ["広告", "スポンサー", "タイアップ投稿"],
    suggested: ["おすすめ", "あなたへのおすすめ"],
    peopleYouMayKnow: ["知り合いかも"],
  },
};

export function getAllSponsoredLabels(): string[] {
  return Object.values(patterns).flatMap((p) => p.sponsored);
}

export function getAllSuggestedLabels(): string[] {
  return Object.values(patterns).flatMap((p) => [
    ...p.suggested,
    ...p.peopleYouMayKnow,
  ]);
}

export function getPatterns(locale: string): LocalePatterns {
  const lang = locale.split(/[-_]/)[0];
  return patterns[locale] || patterns[lang] || patterns.en;
}
