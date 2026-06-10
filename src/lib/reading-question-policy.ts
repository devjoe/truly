const actionableLowRiskPattern =
  /GitHub|原始碼|官方(?:文件|公告|資料|網站|說明|repo)|文件|文檔|repo|repository|source|docs?|API|SDK|CLI|安裝|版本|規格|論文|研究|arXiv|benchmark|模型卡|法規|規定|資格|申請|許可|證照|駕照|牌照|限制/i;

const lowRiskQuestionSuppressPattern =
  /低風險|無需(?:事實)?查核|無查核必要|無事實(?:查核)?需求|無事實風險/;

export function isLowActionReadingBriefText(text: string): boolean {
  return /低風險|純(?:個人|生活|運動|娛樂|遊戲|商業)|無需(?:事實)?查核|無查核必要|無事實(?:查核)?需求|無(?:爭議|爭議性)(?:事實|主張)?|無事實風險/.test(text);
}

export function isLowValueReadingBriefQuestionText(text: string): boolean {
  return /是否.*(?:純個人分享|個人分享|商業(?:推廣|意圖)|推廣意圖)|(?:純個人分享|商業(?:推廣|意圖)).*是否/.test(text);
}

export function isAiImageFallbackQuestionText(text: string): boolean {
  return /這張圖片是否為\s*AI\s*生成或模板素材/.test(text);
}

export function isActionableLowRiskQuestionText(questionText: string, contextText = ""): boolean {
  if (isAiImageFallbackQuestionText(questionText)) return true;
  const text = [questionText, contextText].filter(Boolean).join(" ");
  if (lowRiskQuestionSuppressPattern.test(text)) return false;
  return actionableLowRiskPattern.test(text);
}
