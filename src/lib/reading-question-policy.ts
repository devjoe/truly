import type { Lang } from "./types";

const actionableLowRiskPattern =
  /GitHub|原始碼|官方(?:文件|公告|資料|網站|說明|repo)|文件|文檔|repo|repository|source|docs?|API|SDK|CLI|安裝|版本|規格|論文|研究|arXiv|benchmark|模型卡|法規|規定|資格|申請|許可|證照|駕照|牌照|限制/i;

const lowRiskQuestionSuppressPattern =
  /低風險|無需(?:事實)?查核|無查核必要|無事實(?:查核)?需求|無事實風險/;

const followUpKinds = new Set(["understand", "context", "counter", "image"]);
const verificationQuestionPattern =
  /(?:查核|查證|事實核查|真假|真偽|是否屬實|是否(?:真的|確實|曾|已|有|存在|發生|宣布|確定|參加|獲得|拿下|推出|公布|表示|聲稱|符合|相符)|(?:實際|正確|官方)(?:比分|賽果|賽況|賽事結果|結果|數字|日期|名單|進球者|狀態|內容)|(?:公開信|聲明|公告|報告|文件|貼文|影片|錄音)(?:的)?(?:內容|原文)(?:為何|是什麼|有哪些)|證據(?:是|有|在|來自)|來源(?:是|有|在|來自|哪)|\b(?:source|evidence|verify|verification|fact[ -]?check|true or false|is it true)\b|\b(?:did|has)\s+\S+|\b(?:actual|exact) (?:score|result|date|number)\b|\bwhat did (?:the )?(?:letter|statement|announcement|report|document|post|video|recording) say\b)/i;
const searchArtifactPattern =
  /https?:\/\/|(?:^|\s)(?:google|gemini|bing|curl|wget|npm|pnpm|brew|git)\b|\b(?:site|filetype):\S+/i;

function semanticKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function isReadingBriefFollowUpKind(kind: string): boolean {
  return followUpKinds.has(kind);
}

export function isNaturalReadingBriefFollowUpQuestion(text: string, lang: Lang): boolean {
  const question = text.trim();
  if (!question || !/[?？]$/.test(question)) return false;
  if (verificationQuestionPattern.test(question) || searchArtifactPattern.test(question)) return false;
  if (lang === "zh-TW" && !/\p{Script=Han}/u.test(question)) return false;
  if (lang === "en" && !/[A-Za-z]/.test(question)) return false;
  return true;
}

export function duplicatesReadingBriefVerification(
  question: string,
  verificationTexts: Array<string | undefined>,
): boolean {
  const questionKey = semanticKey(question);
  if (!questionKey) return false;
  return verificationTexts.some((text) => {
    const referenceKey = semanticKey(text || "");
    if (!referenceKey) return false;
    if (referenceKey === questionKey) return true;
    const shorter = referenceKey.length <= questionKey.length ? referenceKey : questionKey;
    const longer = referenceKey.length > questionKey.length ? referenceKey : questionKey;
    return shorter.length >= 12 && shorter.length / longer.length >= 0.8 && longer.includes(shorter);
  });
}

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
