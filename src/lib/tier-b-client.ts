// Tier B classifier: OpenAI-compatible chat completions with optional
// multimodal input. Distinct from `ollama-client.ts`, which serves Tier A's
// fast scoring path. Truly reaches here only when automatic/expand
// Tier B is configured.

import type {
  DashboardPostEvent,
  DeepClassification,
  Lang,
  ReadingBrief,
  ReadingBriefQuestionKind,
} from "./types";
import type { GeneralPageModelContext } from "./general-page-model-context";
import {
  applyGeneralPageBriefPostGuards,
  parseGeneralPageBriefContent,
  type GeneralPageBrief,
} from "./general-page-analysis";
import { buildGeneralPageModelUserPrompt } from "./general-page-model-context";
import {
  buildGeneralPageParserAdvisorSystemPrompt,
  buildGeneralPageParserAdvisorUserPrompt,
  type GeneralPageEffectiveModelContextUse,
  parseGeneralPageParserAdvisorAdvice,
  type GeneralPageParserAdvisorAdvice,
  type GeneralPageParserAdvisorRequest,
} from "./general-page-parser-advisor";
import { compactZhtwEvidence } from "./zhtw-review";
import { resolveStructuredPostContext } from "./post-context";
import { applyDeepOutputReview, applyReadingBriefOutputReview } from "./model-output-review";
import { jsonRequestHeaders } from "./request-auth";

export type { DeepClassification };

export const TIER_B_DEEP_TIMEOUT_MS = 45_000;
export const TIER_B_READING_BRIEF_TIMEOUT_MS = 45_000;
export const TIER_B_GENERAL_PAGE_BRIEF_TIMEOUT_MS = 45_000;
export const TIER_B_GENERAL_PAGE_PARSER_ADVISOR_TIMEOUT_MS = 20_000;
export const TIER_B_CONTEXT_LIMIT_TOKENS = 16_384;
// Keep a client-side guard even though vLLM also receives
// `truncate_prompt_tokens`. CJK-heavy posts can approach two tokens per
// character, so half the token cap is a conservative text-char budget.
export const TIER_B_TEXT_CONTEXT_LIMIT_CHARS = Math.floor(TIER_B_CONTEXT_LIMIT_TOKENS / 2);

const CONDITIONAL_STAKEHOLDER_GUIDANCE =
  "若貼文只是 settled factual answer 或低風險生活內容，請直接簡短回答，不要發明利害關係人辯論、法律 caveat 或歷史爭議；若貼文涉及 contested policy、主權、身分認同、來源歸因、操縱、CIB 或公共爭議，才以繁體中文公平呈現主要利害關係人的觀點，不要將任何一方的主張當作事實，並找出橋接各方的罕見共識";

const ZHTW_OUTPUT_GUIDANCE =
  "所有自然語言欄位使用台灣慣用繁體中文；避免中國慣用語、翻譯腔、簡體字與不自然標點";

const TEMPORAL_CONTEXT_GUIDANCE =
  "不要依賴模型內建知識判斷現在年份；若判斷「現在、今年、去年、近期、昨天、明天、最新、過期」等相對時間，必須使用使用者訊息提供的時間脈絡";

const CONDITIONAL_STAKEHOLDER_GUIDANCE_EN =
  "If the post is a settled factual answer or low-risk everyday content, answer briefly and do not invent stakeholder disputes, legal caveats, or historical controversies. Only when the post involves contested policy, sovereignty, identity, attribution, manipulation, CIB, or public controversy, fairly present the main stakeholders' perspectives in English, do not treat any side's claim as fact, and identify rare common ground that bridges the sides";

const TEMPORAL_CONTEXT_GUIDANCE_EN =
  "Do not rely on the model's internal knowledge to decide the current year. When judging relative time such as now, this year, last year, recently, yesterday, tomorrow, latest, or expired, use the time context supplied in the user message";

export const DEEP_SYSTEM_PROMPT = `你是 Facebook 貼文「深度分析」專家。先讀過貼文文字與媒體圖片，再輸出 JSON：
{
  "sum": "≤40字綜合摘要，含圖片內容線索",
  "txt_ai": 0–1,
  "img_ai": 0–1,
  "com": 0–1,
  "lq": 0–1,
  "fr": 0–1,
  "mr": 0–1,
  "fc": bool,
  "why": "≤40字判讀理由",
  "imgs": [{"i":1,"note":"≤30字圖片觀察"}]
}
規則：
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE}
- ${ZHTW_OUTPUT_GUIDANCE}
- ${TEMPORAL_CONTEXT_GUIDANCE}
- 若貼文文字包含「分享文結構」，請分清楚「分享者評論」與「被分享內容」；不要把原始貼文立場自動當成分享者立場
- txt_ai 只判斷「文字本身是否像 AI 生成」。不要因為主題提到 AI、模型、Copilot、工具、或科技新聞而加分；普通宣傳文案不等於 AI 文
- txt_ai 的正向跡象包含：高度工整且過度完整的段落、報告式或模板化列點、語氣過度平衡、轉折與結論像自動生成摘要、缺少自然個人書寫的細節與節奏。不確定時給 0.3–0.6；多個跡象同時出現才給 ≥0.7
- 若 txt_ai ≥ 0.7，sum 或 why 必須明確寫出文字生成跡象，例如「段落高度工整、語氣像模型摘要」
- img_ai 只判斷「圖片本身是否像 AI 生成」。官方截圖、速查表、Logo、表格、圖卡、stock photo、Canva/模板素材不等於 AI 圖；沒有圖片或圖片無法判斷時填 0
- com 只判斷較明確的販售、業配、課程、折扣、團購、導購、留言私訊拿連結或合作推廣脈絡；一般活動、旅遊資訊、官方服務說明或個人推薦不要只因提到產品/地點而高分
- lq 判斷內容農場、低資訊密度、模板化、來源薄弱或品質疑慮
- fr 判斷事實風險：是否包含需對照可信來源的具體主張
- mr 判斷操弄風險：是否放大情緒、製造對立或強烈引導立場
- fc 表示是否建議查核；fr 高或具體主張缺乏來源時為 true
- imgs 只填 i 與 note；i 是送入圖片順序 1–4，不要回填 URL 或 data URI
- 不要輸出其他欄位
- 不要解釋、不要 markdown，只回傳 JSON。
`;

export const DEEP_SYSTEM_PROMPT_EN = `You are a Facebook post deep-analysis specialist. The post may be written in any language. Always write every natural-language output field in English, regardless of the Facebook UI language or the post language. Read the post text and media images first, then output JSON:
{
  "sum": "integrated summary <=40 English words, including image clues",
  "txt_ai": 0-1,
  "img_ai": 0-1,
  "com": 0-1,
  "lq": 0-1,
  "fr": 0-1,
  "mr": 0-1,
  "fc": bool,
  "why": "judgement reason <=40 English words",
  "imgs": [{"i":1,"note":"image observation <=30 English words"}]
}
Rules:
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE_EN}
- ${TEMPORAL_CONTEXT_GUIDANCE_EN}
- If the post text contains a share/repost structure, separate the sharer's comment from the shared content. Do not automatically attribute the original post's stance to the sharer.
- txt_ai judges only whether the writing itself looks AI-generated. Do not increase the score just because the topic mentions AI, models, Copilot, tools, or tech news. Ordinary promotional copy is not automatically AI-generated.
- Positive txt_ai signs include: highly polished and overly complete paragraphs, report-like or templated bullet lists, overly balanced tone, transitions and conclusions that resemble generated summaries, and lack of natural personal details or rhythm. If uncertain, use 0.3-0.6; use >=0.7 only when multiple signs appear together.
- If txt_ai >= 0.7, sum or why must explicitly name the writing-generation clue, for example "overly structured paragraphs and model-summary tone".
- img_ai judges only whether the image itself looks AI-generated. Official screenshots, cheat sheets, logos, tables, cards, stock photos, or Canva/template materials are not automatically AI images. Use 0 when there is no image or the image cannot be judged.
- com judges clear sales, sponsorship, courses, discounts, group buys, affiliate guidance, "message for link", or collaboration promotion. Do not mark general activities, travel information, official service descriptions, or personal recommendations high just because they mention a product/place.
- lq judges content-farm signals, low information density, template style, weak sourcing, or quality concerns.
- fr judges factual risk: whether the post contains concrete claims that should be checked against credible sources.
- mr judges manipulation risk: whether it amplifies emotion, creates opposition, or strongly steers a position.
- fc means fact-checking is recommended; set true when fr is high or concrete claims lack sources.
- imgs only contains i and note; i is the sent image order 1-4. Do not include URL or data URI.
- Do not output extra fields.
- Do not explain, do not use markdown, and return JSON only.
`;

export const READING_BRIEF_SYSTEM_PROMPT = `你是 Facebook 貼文的「閱讀重點」規劃員。你會收到貼文文字、既有深度分析 JSON、圖片觀察與來源脈絡。請輸出一份可操作的閱讀簡報 JSON：
{
  "bg": [{"t":"≤12字背景","why":"≤28字原因","q":"≤36字問題"}],
  "claims": [{"c":"≤36字主張","why":"≤28字重要性","need":"≤24字證據","q":"≤36字問題"}],
  "qs": [{"q":"≤36字問題","kind":"understand|context|counter|verify|image|source"}],
  "checks": [{"label":"≤10字項目","q":"≤36字問題","why":"≤28字原因"}],
  "note": "≤36字提醒"
}
規則：
- 保持極短。每個字串都用短句，不要解釋背景細節
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE}
- ${ZHTW_OUTPUT_GUIDANCE}
- ${TEMPORAL_CONTEXT_GUIDANCE}
- bg 最多 2 筆，claims/qs/checks 各最多 3 筆；沒有有用項目就回空陣列
- bg.t 必須是名詞短語，不要以「的」「之」結尾；bg.why 必須是完整短句
- 這不是事實查核結果；只提出閱讀者下一步該理解或查核什麼
- 只有高事實風險、公共議題、數字主張或明確來源疑慮才把內容放進 claims/checks
- 若 riskProfile.lookupWorthy=false，claims/checks 必須回空陣列；qs 預設回空陣列。只有技術工具、原始碼、官方文件、安裝/API/論文/benchmark、法規/證照/資格這類可直接行動的問題，才可輸出最多 1 筆 understand/context
- 生活、旅遊、鳥照、寵物、賽事紀錄、官方社群分享、個人心得、一般活動紀錄等低風險內容，優先輸出 1 筆 bg 或 note；不要硬列查核主張或延伸問題
- 商業、公共議題、高事實風險、AI 圖文疑慮或低品質訊號明確時，才輸出可查核主張、來源問題或下一步查核
- 不要發明外部事實、來源、網址、人物背景或動機
- qs/checks 的 q 會直接交給搜尋引擎；不得只寫「這篇貼文」「此內容」「它」等代稱，必須補入可搜尋的具體名詞、人物、機構、事件或關鍵詞
- 若是轉貼，分開看分享者評論與被分享內容
- 若圖片只是截圖、Logo、圖表或裝飾，不要過度解讀
- zhtw 只提供「用語慣例」線索；只有在有助閱讀、搜尋關鍵字或查核時才使用
- 不得根據 zhtw 推論作者來源、分享者來源、國籍、政治身分、帳號真偽、動機或內容真假
- 若 zhtw 對查核有幫助，可把台灣常用詞納入 qs/checks/note；若無助，完全不要提
- 不要輸出其他欄位
- 不要 markdown，只回傳 JSON。
`;

export const READING_BRIEF_SYSTEM_PROMPT_EN = `You are a Reading Brief planner for Facebook posts. The post may be written in any language. Always write every natural-language output field in English, regardless of the Facebook UI language or the post language. You will receive post text, an existing deep-analysis JSON, image observations, and source context. Output an actionable reading brief JSON:
{
  "bg": [{"t":"background <=12 English words","why":"reason <=28 English words","q":"question <=36 English words"}],
  "claims": [{"c":"claim <=36 English words","why":"importance <=28 English words","need":"evidence needed <=24 English words","q":"question <=36 English words"}],
  "qs": [{"q":"question <=36 English words","kind":"understand|context|counter|verify|image|source"}],
  "checks": [{"label":"item <=10 English words","q":"question <=36 English words","why":"reason <=28 English words"}],
  "note": "reminder <=36 English words"
}
Rules:
- Keep it extremely short. Every string should be a short phrase or sentence; do not explain background details.
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE_EN}
- ${TEMPORAL_CONTEXT_GUIDANCE_EN}
- bg has at most 2 items; claims/qs/checks each have at most 3 items. Return empty arrays when there are no useful items.
- bg.t must be a noun phrase; bg.why must be a complete short sentence.
- This is not a fact-check result. It only proposes what the reader should understand or verify next.
- Put content into claims/checks only for high factual risk, public issues, numeric claims, or clear source concerns.
- If riskProfile.lookupWorthy=false, claims/checks must be empty and qs should be empty by default. Only output at most 1 understand/context question for directly actionable topics such as technical tools, source code, official documents, installation/API/papers/benchmarks, laws, licenses, or qualifications.
- For low-risk life, travel, bird photos, pets, sports records, official social sharing, personal reflections, or general activity records, prefer 1 bg item or note; do not force checkable claims or follow-up questions.
- Output checkable claims, source questions, or next checks only when commercial, public-issue, high-factual-risk, AI image/text concern, or low-quality signals are clear.
- Do not invent external facts, sources, URLs, biographies, or motives.
- qs/checks.q may be sent directly to a search/chat engine. Do not write only "this post", "this content", or "it"; include searchable names, people, organizations, events, or keywords.
- If this is a repost, separate the sharer's comment from the shared content.
- If images are screenshots, logos, charts, or decorations, do not over-interpret them.
- Do not output extra fields.
- Do not use markdown; return JSON only.
`;

export function tierBOutputLang(outputLang?: Lang): Lang {
  return outputLang === "en" ? "en" : "zh-TW";
}

export function deepSystemPrompt(outputLang?: Lang): string {
  return tierBOutputLang(outputLang) === "en" ? DEEP_SYSTEM_PROMPT_EN : DEEP_SYSTEM_PROMPT;
}

export function readingBriefSystemPrompt(outputLang?: Lang): string {
  return tierBOutputLang(outputLang) === "en" ? READING_BRIEF_SYSTEM_PROMPT_EN : READING_BRIEF_SYSTEM_PROMPT;
}

export function generalPageBriefSystemPrompt(
  outputLang: Lang | undefined,
  allowedUse: GeneralPageEffectiveModelContextUse,
  contract: "standard" | "investigation_v3" = "standard",
): string {
  const lang = tierBOutputLang(outputLang);
  const overview = allowedUse === "page_overview_only";
  const investigation = contract === "investigation_v3";
  if (lang === "en") {
    return [
      "You are Truly's General Page reading assistant. Return exactly one JSON object and nothing else.",
      investigation
        ? "Required shape: {\"schemaVersion\":1,\"summary\":\"neutral summary\",\"bg\":[{\"t\":\"point\",\"why\":\"importance\"}],\"claims\":[{\"c\":\"claim\",\"why\":\"importance\",\"need\":\"evidence\",\"q\":\"verification question\",\"atom\":{\"s\":\"subject\",\"p\":\"one relation\",\"o\":\"object or outcome\"},\"policy\":{\"claimKind\":\"fact|report|estimate|forecast|allegation|expert_analysis\",\"consequence\":\"health|safety|money|rights|law|public_interest\"}}],\"qs\":[{\"q\":\"follow-up question\",\"kind\":\"understand|context|counter|image\"}],\"note\":\"optional reminder\"}. schemaVersion and summary are always required. bg, claims, and qs must be arrays of objects or empty arrays, never arrays of strings."
        : "Required shape: {\"schemaVersion\":1,\"summary\":\"neutral summary\",\"bg\":[{\"t\":\"point\",\"why\":\"importance\"}],\"claims\":[{\"c\":\"claim\",\"why\":\"importance\",\"need\":\"evidence\",\"q\":\"verification question\",\"atom\":{\"s\":\"subject\",\"p\":\"one relation\",\"o\":\"object or outcome\"}}],\"qs\":[{\"q\":\"follow-up question\",\"kind\":\"understand|context|counter|image\"}],\"note\":\"optional reminder\"}. schemaVersion and summary are always required. bg, claims, and qs must be arrays of objects or empty arrays, never arrays of strings.",
      "Write every natural-language field in English. summary <=32 words; bg <=2 items; claims <=1 item; qs <=1 item. Keep every other string under 28 words.",
      "Use only the supplied page context. Do not invent sources, dates, authors, facts, motives, or URLs.",
      "When targetKind is selection, summarize and analyze only the selected text; surrounding text is context only.",
      overview
        ? "This is page overview only. Describe what kind of page it is, what linked topics or sections appear, and what the reader may inspect next. Return claims as an empty array or omit it. Do not produce article-grade claims."
        : "Return one neutral summary, useful background, and at most one supported claim or follow-up question.",
      "Emit a claim only for a concrete assertion whose verification could materially change judgment about health, safety, money, rights, law, or a public-interest event. Otherwise return claims: [].",
      "Claims MUST be empty for opinions, personal experience, humor, routine activity, engagement/publication metadata, ordinary discounts/coupons/course counts, routine product features, marketing goals, interface locations, AI-writing guesses, indexes, feeds, or mixed headlines. Vulnerable-group health/safety suitability remains consequential.",
      "Claims MUST also be empty for broad marketing problem statements such as a product saying that AI cannot understand notes, unless the page gives one complete, consequential, externally checkable proposition.",
      "Every claim must express exactly one atomic assertion and MUST include atom.s, atom.p, and atom.o. Copy three short, non-overlapping substrings verbatim from claim.c: one concrete subject, the shortest factual relation, and one concrete object/outcome. Never paraphrase atom values and never put the whole claim into atom.p or atom.o. claim.c must contain no second proposition.",
      "atom.p must be one short relation (at most 6 English words); atom.o must be one noun phrase or outcome and must not hide another action, record, consequence, or promise. A match result plus a historical record, an announcement plus a future plan, and a current figure plus a comparison are each two assertions: choose only one.",
      "If a source sentence contains multiple assertions, select only one and rewrite claim.c as that one complete assertion; never copy the compound sentence unchanged. Bad: ‘India recorded its driest June in 12 years and its fifth-driest since 1901.’ Good: ‘India recorded its driest June in 12 years.’",
      "claim.c must be a complete sentence with terminal punctuation. If the supplied page text or candidate sentence ends abruptly, omit the claim instead of completing or guessing it.",
      "Keep attribution and modality exact: said, reported, estimated, alleged, planned, and confirmed are different relations. Do not turn an attributed statement, forecast, or allegation into an established fact.",
      ...(investigation ? [
        "Every claim MUST include policy. claimKind classifies the atomic assertion; consequence names the one material health, safety, money, rights, law, or public-interest judgment that verification could change. Product availability, personal opinion, and generic controversy are never action-eligible and must be omitted from claims.",
        "attribution is OPTIONAL and MUST be omitted for a direct atom. It is required only when claim.c frames the atom through a separate speaker, report, estimate, allegation, forecast, or analysis before or after the atom. Then add attribution:{source,relation,modality}, copy source and relation verbatim from claim.c outside the atom, and use modality statement|report|estimate|allegation|forecast|analysis. Never invent attribution, omit a real outer attribution, or place it only in why/need/q.",
      ] : []),
      "claim.q must be one natural question about the same atom and copy atom.s, atom.p, and atom.o verbatim. It must not use vague references, URLs, domains, Markdown, search-engine names, commands, keyword lists, or facts absent from the page. Omit the claim if q is unreliable.",
      "Preserve legal stage exactly: arrested, charged, denied bail, convicted, and sentenced are never interchangeable. claim.q must preserve atom.p's legal wording.",
      "qs is only for understanding, context, counter-perspectives, or image interpretation; never verify/source and never duplicate the claim.",
      "Do not use markdown. Do not output extra fields.",
    ].join("\n");
  }
  return [
    "你是 Truly 的一般網頁閱讀助理。只能回傳一個 JSON 物件，不得輸出其他文字。",
    investigation
      ? "必須符合：{\"schemaVersion\":1,\"summary\":\"中立摘要\",\"bg\":[{\"t\":\"重點\",\"why\":\"為何重要\"}],\"claims\":[{\"c\":\"主張\",\"why\":\"為何重要\",\"need\":\"需要的證據\",\"q\":\"查核問題\",\"atom\":{\"s\":\"主體\",\"p\":\"單一關係\",\"o\":\"受詞或結果\"},\"policy\":{\"claimKind\":\"fact|report|estimate|forecast|allegation|expert_analysis\",\"consequence\":\"health|safety|money|rights|law|public_interest\"}}],\"qs\":[{\"q\":\"延伸問題\",\"kind\":\"understand|context|counter|image\"}],\"note\":\"可選提醒\"}。schemaVersion 與 summary 永遠必填；bg、claims、qs 必須是物件陣列或空陣列，絕對不可使用字串陣列。"
      : "必須符合：{\"schemaVersion\":1,\"summary\":\"中立摘要\",\"bg\":[{\"t\":\"重點\",\"why\":\"為何重要\"}],\"claims\":[{\"c\":\"主張\",\"why\":\"為何重要\",\"need\":\"需要的證據\",\"q\":\"查核問題\",\"atom\":{\"s\":\"主體\",\"p\":\"單一關係\",\"o\":\"受詞或結果\"}}],\"qs\":[{\"q\":\"延伸問題\",\"kind\":\"understand|context|counter|image\"}],\"note\":\"可選提醒\"}。schemaVersion 與 summary 永遠必填；bg、claims、qs 必須是物件陣列或空陣列，絕對不可使用字串陣列。",
    `所有自然語言欄位使用台灣慣用繁體中文。summary 80 字內；bg 最多 2 項；claims 最多 1 項；qs 最多 1 項。${ZHTW_OUTPUT_GUIDANCE}。`,
    "只能使用提供的頁面脈絡。不要發明來源、日期、作者、事實、動機或網址。",
    "targetKind 是 selection 時，只摘要與分析選取文字；surrounding text 只能當脈絡，不可當成摘要主體。",
    overview
      ? "這只允許頁面總覽。請描述這是什麼類型的頁面、它連到哪些主題或區塊、讀者下一步可檢視什麼。claims 必須回空陣列或省略，不得產生文章級查核主張。"
      : "回傳一個中立摘要、有用背景，以及至多一個文本支持的 claim 或延伸問題。",
    "只有查證結果可能實質改變健康、安全、金錢、權利、法律或公共事件判斷的具體陳述才能放入 claims；否則回傳 claims: []。",
    "意見、個人經驗、玩笑、日常活動、互動或發布資訊、一般折扣／折扣碼／課程數量、普通產品功能、行銷目標、介面位置、AI 文風猜測、索引、feed 或混合標題，claims 必須為空。脆弱族群適用性的健康或安全宣稱仍具後果。",
    "產品宣稱「AI 無法理解筆記」之類的廣泛行銷問題陳述，claims 也必須為空；除非頁面提供一個完整、具後果且可由外部證據查核的命題。",
    "每個 claim 只能有一個原子主張，並必須包含 atom.s、atom.p、atom.o。三者必須是從 claims.c 原樣複製的三段簡短、不重疊文字：一個具體主體、最短的事實關係、一個具體受詞或結果。不得改寫 atom，不得把整句塞進 atom.p 或 atom.o；claims.c 不得再包含第二個命題。",
    "atom.p 只能是一個短關係（最多 12 個中文字），atom.o 只能是一個名詞片語或結果，不得暗藏另一個動作、紀錄、後果或承諾。賽果加歷史紀錄、宣布加未來計畫、目前數字加前期比較，都各是兩個陳述，只能選一個。",
    "來源句若含多個陳述，只選一個並把 claims.c 改寫成該單一完整陳述，不得原樣複製複合句。錯誤：『6 月中古屋價格月減 0.42%，且跌幅較 5 月擴大。』正確：『6 月中古屋價格月減 0.42%。』",
    "claims.c 必須是有句末標點的完整句。頁面文字或候選句若在中途截斷，必須省略 claim，不得自行補完或猜測。",
    "來源歸因與語氣必須保持原意：表示、報導、估計、指稱、預計與確認是不同關係；不得把引述、預測或指控改寫成已成立的事實。",
    ...(investigation ? [
      "每個 claim 都必須包含 policy。claimKind 分類該原子主張；consequence 必須指出查證結果會改變的單一健康、安全、金錢、權利、法律或公共利益判斷。產品是否供應、個人意見與泛稱引發爭議都不得成為可查核 action，應省略 claim。",
      "attribution 是選填；直接陳述 atom 時必須省略。只有 claims.c 在 atom 前後另有說話者、報導、估計、指控、預測或分析來源時才必填 attribution:{source,relation,modality}。source 與 relation 必須從 atom 之外的 claims.c 原樣複製，modality 使用 statement|report|estimate|allegation|forecast|analysis；不得捏造歸因、省略真正的外層歸因，或只把歸因放在 why、need、q。",
    ] : []),
    "claims.q 必須是查核同一 atom 的一個自然問句，並原樣寫出 atom.s、atom.p、atom.o；不得使用代稱、網址、網域、Markdown、搜尋引擎名稱、操作指令、關鍵字清單或頁面未出現的事實。無法可靠產生 q 就省略 claim。",
    "法律程序必須保持原詞：被捕、被控、不得交保、被判有罪與被判刑絕對不可互換；claims.q 必須保持 atom.p 的法律狀態。",
    "qs 只放理解、背景、反方觀點或影像理解問題，不得使用 verify/source，不得重述 claim。",
    "不要 markdown，不要輸出其他欄位。",
  ].join("\n");
}

interface ChatContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface PromptTemporalContext {
  nowUtc: string;
  localDateTime: string;
  timezone: string;
  currentYear: number;
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function localDateParts(now: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function buildPromptTemporalContext(now = new Date()): PromptTemporalContext {
  const timezone = currentTimezone();
  const parts = localDateParts(now, timezone);
  const localDateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    nowUtc: now.toISOString(),
    localDateTime,
    timezone,
    currentYear: Number(parts.year) || now.getUTCFullYear(),
  };
}

function temporalContextBlock(
  context = buildPromptTemporalContext(),
  outputLang: Lang = "zh-TW",
): string {
  if (outputLang === "en") {
    return [
      "## Time Context",
      `Current date/time (UTC): ${context.nowUtc}`,
      `User local time: ${context.localDateTime}`,
      `User timezone: ${context.timezone}`,
      `Current year: ${context.currentYear}`,
      "Use this as the basis for relative-time and freshness judgments. Do not use the model's built-in current year.",
    ].join("\n");
  }
  return [
    "## 時間脈絡",
    `目前日期時間（UTC）：${context.nowUtc}`,
    `使用者本地時間：${context.localDateTime}`,
    `使用者時區：${context.timezone}`,
    `目前年份：${context.currentYear}`,
    "請以此作為相對時間與時效性判斷基準，不要使用模型內建的現在年份。",
  ].join("\n");
}

/**
 * Build the user-message content array for the Tier B OpenAI-compatible
 * `/v1/chat/completions`. Images are appended as `image_url` parts;
 * callers prefetch/re-encode them before dispatch.
 */
export function buildTierBUserContent(
  text: string,
  imageUrls: string[],
  outputLang?: Lang,
): ChatContent[] {
  const parts: ChatContent[] = [];
  const lang = tierBOutputLang(outputLang);
  const postLabel = lang === "en" ? "## Post Text" : "## 貼文文字";
  const answerLabel = lang === "en"
    ? "\n\n## Required Answer Language\nAlways answer in English. The post itself may be in any language."
    : "";
  const header = `${temporalContextBlock(buildPromptTemporalContext(), lang)}${answerLabel}\n\n${postLabel}\n${text.slice(0, TIER_B_TEXT_CONTEXT_LIMIT_CHARS)}`;
  parts.push({ type: "text", text: header });
  for (const url of imageUrls.slice(0, 4)) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

export interface TierBDeepRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  text: string;
  imageUrls: string[];
  /** Count of images dropped by `extractPostImages`'s Tier B unsafe
   *  pre-filter. When `imageUrls` is empty AND this is > 0, the
   *  result's `imageStatus` is `"filtered"` rather than `"no_images"`. */
  filteredImageCount?: number;
  timeoutMs?: number;
  outputLang?: Lang;
}

export type TierBDeepErrorCode =
  | "tier_b_network_error"
  | "tier_b_timeout"
  | "tier_b_http_error"
  | "tier_b_format_error"
  | "tier_b_response_truncated"
  | "tier_b_reasoning_without_json"
  | "tier_b_failed";

export interface TierBDeepResult {
  ok: boolean;
  deep: DeepClassification | null;
  error?: TierBDeepErrorCode | string;
}

export interface TierBReadingBriefRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  event: DashboardPostEvent;
  timeoutMs?: number;
  outputLang?: Lang;
}

export interface TierBGeneralPageParserAdvisorRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  request: GeneralPageParserAdvisorRequest;
  timeoutMs?: number;
  outputLang?: Lang;
}

export interface TierBGeneralPageBriefRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  context: GeneralPageModelContext;
  allowedUse: GeneralPageEffectiveModelContextUse;
  timeoutMs?: number;
  outputLang?: Lang;
  /** Opt-in candidate contract used only by private evaluation. */
  contract?: "standard" | "investigation_v3";
  /** Opt-in format repair used only while evaluating an unstable candidate contract. */
  enableFormatRepair?: boolean;
  /** User-confirmed visible-tab screenshot as a data URL (vision providers only). */
  screenshotDataUrl?: string;
}

export interface TierBGeneralPageBriefResult {
  ok: boolean;
  brief: GeneralPageBrief | null;
  raw?: string;
  /** Number of model requests used. A second request is allowed only when an
   *  explicitly opted-in candidate response fails the General Page contract. */
  attempts?: 1 | 2;
  formatRecovered?: boolean;
  error?: "general_page_brief_network_error" | "general_page_brief_timeout" | "general_page_brief_http_error" | "general_page_brief_format_error";
}

export interface TierBGeneralPageParserAdvisorResult {
  ok: boolean;
  advice: GeneralPageParserAdvisorAdvice | null;
  raw?: string;
  error?: "parser_advisor_network_error" | "parser_advisor_timeout" | "parser_advisor_http_error" | "parser_advisor_format_error";
}

export interface TierBVisionProbeRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface TierBVisionProbeResult {
  ok: boolean;
  raw?: string;
  error?: "vision_probe_network_error" | "vision_probe_timeout" | "vision_probe_http_error" | "vision_probe_format_error";
}

export interface TierBChatBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string | ChatContent[] }>;
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
  reasoning_effort?: "none";
  truncate_prompt_tokens: number;
  chat_template_kwargs: { enable_thinking: boolean };
}

export const TIER_B_VISION_PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQTf7/HwAEvwKHHvca0gAAAABJRU5ErkJggg==";

export function tierBCompletionsUrl(endpoint: string): string {
  const baseUrl = endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return `${baseUrl}/v1/chat/completions`;
}

export function shouldRequestOpenAICompatNoThinking(endpoint: string, model: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.port === "11434") return true;
    const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (localHost && model.includes(":") && !model.includes("/")) return true;
  } catch {
    // Fall through to the model-id heuristic below.
  }
  return model.includes(":") && !model.includes("/");
}

export function buildTierBDeepChatBody(
  req: TierBDeepRequest,
  includeImages = true,
): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: deepSystemPrompt(req.outputLang) },
      {
        role: "user",
        content: buildTierBUserContent(
          req.text,
          includeImages ? req.imageUrls : [],
          req.outputLang,
        ),
      },
    ],
    temperature: 0,
    // ---- max_tokens sizing ----
    // Worst-case Tier B JSON response (4 image slots filled, all CJK
    // text fields at max length, all numeric fields at 0.99):
    //   ~830 characters total (712 ASCII + 118 CJK)
    //   ~426 tokens with Qwen3.6 tokenizer (CJK ≈ 1.8 tok/char, ASCII ≈ 0.3 tok/char)
    //   × 1.4 safety buffer = 596 → round to 600.
    // When the response schema grows, rebuild the worst-case JSON, count
    // tokens, multiply by 1.4, and update this constant.
    max_tokens: 600,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

function clampText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function normalizeBriefArray<T>(
  raw: unknown,
  limit: number,
  map: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: T[] = [];
  for (const item of raw) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeReadingBrief(raw: any, model: string, outputLang?: Lang): ReadingBrief {
  const lang = tierBOutputLang(outputLang);
  const brief: ReadingBrief = { model, outputLang: lang };
  brief.bg = normalizeBriefArray(raw?.bg, 2, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const t = clampText(x.t, 24);
    const why = clampText(x.why, 60);
    if (!t || !why) return undefined;
    const q = clampText(x.q, 80);
    return q ? { t, why, q } : { t, why };
  });
  brief.claims = normalizeBriefArray(raw?.claims, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const c = clampText(x.c, 70);
    const why = clampText(x.why, 60);
    const need = clampText(x.need, 60);
    if (!c || !why || !need) return undefined;
    const q = clampText(x.q, 80);
    return q ? { c, why, need, q } : { c, why, need };
  });
  brief.qs = normalizeBriefArray(raw?.qs, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const q = clampText(x.q, 80);
    const kind = typeof x.kind === "string" ? x.kind : "";
    if (!q || !["understand", "context", "counter", "verify", "image", "source"].includes(kind)) {
      return undefined;
    }
    return { q, kind: kind as ReadingBriefQuestionKind };
  });
  brief.checks = normalizeBriefArray(raw?.checks, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const label = clampText(x.label, 20);
    const q = clampText(x.q, 80);
    const why = clampText(x.why, 60);
    if (!label || !q || !why) return undefined;
    return { label, q, why };
  });
  const note = clampText(raw?.note, 60);
  if (note) brief.note = note;
  return lang === "zh-TW" ? applyReadingBriefOutputReview(brief) : brief;
}

interface ParsedReadingBriefContent {
  ok: boolean;
  value: ReadingBrief | null;
  error?: string;
}

export function parseTierBReadingBriefContent(
  raw: string,
  model: string,
  outputLang?: Lang,
): ParsedReadingBriefContent {
  const jsonText = extractDeepJsonObject(raw);
  if (!jsonText) {
    return { ok: false, value: null, error: "no_strict_json_object" };
  }
  try {
    return { ok: true, value: normalizeReadingBrief(JSON.parse(jsonText), model, outputLang) };
  } catch (e) {
    return {
      ok: false,
      value: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "bad_json",
    };
  }
}

export function buildReadingBriefPrompt(event: DashboardPostEvent, outputLang?: Lang): string {
  const lang = tierBOutputLang(outputLang);
  const deep = event.decision.deepClassification;
  const scores = event.decision.scores ?? {};
  const iq = deep?.informationQuality;
  const context = resolveStructuredPostContext(event);
  const factualRisk = iq?.factualRisk ?? 0;
  const commercial = deep?.commercialIntent ?? scores.commercial ?? 0;
  const riskProfile = {
    highRisk: Boolean(
      iq?.needsFactCheck ||
        factualRisk >= 0.7,
    ),
    lookupWorthy: Boolean(
      iq?.needsFactCheck ||
        factualRisk >= 0.5 ||
        (scores.political ?? 0) >= 0.6 ||
        commercial >= 0.6 ||
        (deep?.textAiLikelihood ?? 0) >= 0.8 ||
        (deep?.imageAiLikelihood ?? 0) >= 0.8 ||
        (deep?.lowQualitySignal ?? 0) >= 0.6 ||
        (iq?.manipulationRisk ?? 0) >= 0.6,
    ),
    lowRiskPersonal: Boolean(
      !iq?.needsFactCheck &&
        factualRisk < 0.4 &&
        (scores.political ?? 0) < 0.6 &&
        commercial < 0.6 &&
        (deep?.textAiLikelihood ?? 0) < 0.8 &&
        (deep?.imageAiLikelihood ?? 0) < 0.8 &&
        (deep?.lowQualitySignal ?? 0) < 0.6 &&
        (iq?.manipulationRisk ?? 0) < 0.6,
    ),
  };
  const payload: Record<string, unknown> = {
    outputLanguage: lang === "en" ? "English" : "Taiwan Traditional Chinese",
    temporalContext: buildPromptTemporalContext(),
    post: {
      author: event.authorName,
      text: (context.isShare ? context.sharerComment : context.ownText).slice(0, 3000),
      sharedText: context.sharedContent.slice(0, 1600),
      linkPreview: context.linkPreview.slice(0, 1000),
      imageText: context.imageTexts.slice(0, 4),
      imageAlt: context.imageAltTexts.slice(0, 4),
      originalAuthor: context.originalAuthor,
      contentKind: event.contentKind,
      postType: event.postType,
      hasMedia: event.hasMedia,
      postUrl: event.postUrl,
      pageUrl: event.pageUrl,
    },
    tierB: deep ? {
      summary: deep.summary,
      textAiLikelihood: deep.textAiLikelihood,
      imageAiLikelihood: deep.imageAiLikelihood,
      commercialIntent: deep.commercialIntent,
      lowQualitySignal: deep.lowQualitySignal,
      informationQuality: deep.informationQuality,
      imageInsights: deep.imageInsights,
      imageStatus: deep.imageStatus,
    } : undefined,
    tierA: {
      scores: event.decision.scores,
      primaryCategory: event.decision.primaryCategory,
      primaryScore: event.decision.primaryScore,
    },
    riskProfile,
  };
  if (lang === "zh-TW") {
    payload.zhtw = compactZhtwEvidence(event.zhtwReview ?? event.decision.zhtwReview);
  }
  const instruction = lang === "en"
    ? "Produce a reading brief from the following JSON. The post may be in any language; write all output fields in English."
    : "請根據以下 JSON 產生閱讀簡報。";
  return `${instruction}\n${JSON.stringify(payload)}`;
}

export function buildTierBReadingBriefChatBody(req: TierBReadingBriefRequest): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: readingBriefSystemPrompt(req.outputLang) },
      { role: "user", content: buildReadingBriefPrompt(req.event, req.outputLang) },
    ],
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export function buildGeneralPageBriefPrompt(
  context: GeneralPageModelContext,
  outputLang?: Lang,
): string {
  const lang = tierBOutputLang(outputLang);
  const answerLabel = lang === "en"
    ? "## Required Answer Language\nAlways answer in English. The page itself may be in any language."
    : "## 輸出語言\n所有自然語言欄位使用台灣慣用繁體中文。";
  return [
    temporalContextBlock(buildPromptTemporalContext(), lang),
    answerLabel,
    buildGeneralPageModelUserPrompt(context),
  ].join("\n\n");
}

export function buildTierBGeneralPageBriefChatBody(req: TierBGeneralPageBriefRequest): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: generalPageBriefSystemPrompt(req.outputLang, req.allowedUse, req.contract) },
      { role: "user", content: generalPageBriefUserContent(req) },
    ],
    temperature: 0,
    max_tokens: 720,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export function buildTierBGeneralPageBriefRepairChatBody(req: TierBGeneralPageBriefRequest): TierBChatBody {
  const lang = tierBOutputLang(req.outputLang);
  const overview = req.allowedUse === "page_overview_only";
  const system = lang === "en"
    ? [
        "You are repairing a General Page reading response. Return JSON only, with exactly these top-level keys: schemaVersion, summary, bg, claims, qs, note.",
        "Use schemaVersion:1. summary is required. bg, claims, and qs are object arrays; use [] when empty.",
        "Keep the response compact: summary <=32 words, bg <=2 items, claims <=1 item, qs <=1 item, and every other string <=28 words. Do not reproduce the page text.",
        overview
          ? "This is page overview only. claims must be []."
          : "claims has at most one consequential, externally checkable atomic assertion; otherwise use [].",
        "A claim requires c, why, need, q, atom:{s,p,o}, and policy:{claimKind,consequence}. claimKind is fact|report|estimate|forecast|allegation|expert_analysis. consequence is health|safety|money|rights|law|public_interest.",
        "Optional attribution:{source,relation,modality} is allowed only for a real outer source frame before or after the atom. Preserve it in q. Do not invent facts or use markdown.",
      ].join("\n")
    : [
        "你正在修復一般網頁閱讀結果。只能回傳 JSON，頂層只能有 schemaVersion、summary、bg、claims、qs、note。",
        "schemaVersion 必須是 1；summary 必填；bg、claims、qs 必須是物件陣列，沒有內容就用 []。所有自然語言欄位使用台灣慣用繁體中文。",
        "輸出必須精簡：summary 80 字內、bg 最多 2 項、claims 最多 1 項、qs 最多 1 項，其他字串 60 字內；不得重述頁面全文。",
        overview
          ? "這只是頁面總覽，claims 必須是 []。"
          : "claims 最多一項，只能放具後果、可由外部證據查核的原子主張；否則用 []。",
        "claim 必須包含 c、why、need、q、atom:{s,p,o}、policy:{claimKind,consequence}。claimKind 只能是 fact|report|estimate|forecast|allegation|expert_analysis；consequence 只能是 health|safety|money|rights|law|public_interest。",
        "只有 atom 前後確實有外層來源框架時才能加入 attribution:{source,relation,modality}，並在 q 保留歸因。不得發明事實，不得使用 Markdown。",
      ].join("\n");
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: generalPageBriefUserContent(req) },
    ],
    temperature: 0,
    max_tokens: 800,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) body.reasoning_effort = "none";
  return body;
}

function generalPageBriefUserContent(req: TierBGeneralPageBriefRequest): string | ChatContent[] {
  const userText = buildGeneralPageBriefPrompt(req.context, req.outputLang);
  return req.screenshotDataUrl
    ? [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: req.screenshotDataUrl } },
      ]
    : userText;
}

export function buildTierBGeneralPageParserAdvisorChatBody(
  req: TierBGeneralPageParserAdvisorRequest,
): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: buildGeneralPageParserAdvisorSystemPrompt() },
      { role: "user", content: buildGeneralPageParserAdvisorUserPrompt(req.request) },
    ],
    temperature: 0,
    max_tokens: 420,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: Math.min(TIER_B_CONTEXT_LIMIT_TOKENS, 8192),
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export function buildTierBVisionProbeChatBody(req: TierBVisionProbeRequest): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      {
        role: "system",
        content: "You are a vision capability probe. Answer with one lowercase English color word only.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the dominant color of the attached image? Answer with one word only.",
          },
          { type: "image_url", image_url: { url: TIER_B_VISION_PROBE_IMAGE } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 8,
    truncate_prompt_tokens: 512,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export async function callTierBVisionProbe(
  req: TierBVisionProbeRequest,
): Promise<TierBVisionProbeResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 12_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBVisionProbeChatBody(req)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 240); } catch { /* ignore */ }
      console.warn(`[Truly Tier B vision] HTTP ${resp.status}: ${errBody}`);
      return { ok: false, error: "vision_probe_http_error", raw: errBody };
    }
    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || "").trim();
    return {
      ok: /\b(blue|cyan)\b/i.test(raw),
      raw: raw.slice(0, 120),
      error: /\b(blue|cyan)\b/i.test(raw) ? undefined : "vision_probe_format_error",
    };
  } catch (error) {
    console.warn("[Truly Tier B vision] error:", error);
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "vision_probe_timeout"
      : "vision_probe_network_error";
    return { ok: false, error: code };
  } finally {
    clearTimeout(timer);
  }
}

export async function callTierBReadingBrief(
  req: TierBReadingBriefRequest,
): Promise<ReadingBrief | null> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_READING_BRIEF_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBReadingBriefChatBody(req)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
      console.warn(`[Truly Tier B-2] HTTP ${resp.status}: ${errBody}`);
      return null;
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = parseTierBReadingBriefContent(raw, req.model, req.outputLang);
    if (!parsed.ok) {
      console.warn(`[Truly Tier B-2] ${parsed.error}:`, raw.slice(0, 200));
      return null;
    }
    return parsed.value;
  } catch (e) {
    console.warn("[Truly Tier B-2] error:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function callTierBGeneralPageBrief(
  req: TierBGeneralPageBriefRequest,
): Promise<TierBGeneralPageBriefResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_GENERAL_PAGE_BRIEF_TIMEOUT_MS);
  try {
    const attempts = req.enableFormatRepair ? ([1, 2] as const) : ([1] as const);
    for (const attempt of attempts) {
      const body = attempt === 1
        ? buildTierBGeneralPageBriefChatBody(req)
        : buildTierBGeneralPageBriefRepairChatBody(req);
      const resp = await fetch(url, {
        method: "POST",
        headers: jsonRequestHeaders(req.apiKey),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        let errBody = "";
        try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
        console.warn(`[Truly General Page Brief] HTTP ${resp.status}`);
        return { ok: false, brief: null, raw: errBody, attempts: attempt, error: "general_page_brief_http_error" };
      }
      const data = await resp.json();
      const raw = String(data?.choices?.[0]?.message?.content || "").trim();
      const parsed = parseGeneralPageBriefContent(raw, req.model, req.outputLang);
      if (!parsed.ok || !parsed.value) {
        console.warn(`[Truly General Page Brief] contract error: ${parsed.error}`);
        if (attempt === 1 && req.enableFormatRepair) continue;
        return { ok: false, brief: null, raw: raw.slice(0, 1200), attempts: attempt, error: "general_page_brief_format_error" };
      }
      const brief = applyGeneralPageBriefPostGuards(parsed.value, req.allowedUse);
      return {
        ok: true,
        brief,
        raw: raw.slice(0, 1200),
        attempts: attempt,
        ...(attempt === 2 ? { formatRecovered: true } : {}),
      };
    }
    return { ok: false, brief: null, attempts: req.enableFormatRepair ? 2 : 1, error: "general_page_brief_format_error" };
  } catch (error) {
    console.warn("[Truly General Page Brief] error:", error);
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "general_page_brief_timeout"
      : "general_page_brief_network_error";
    return { ok: false, brief: null, error: code };
  } finally {
    clearTimeout(timer);
  }
}

export async function callTierBGeneralPageParserAdvisor(
  req: TierBGeneralPageParserAdvisorRequest,
): Promise<TierBGeneralPageParserAdvisorResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_GENERAL_PAGE_PARSER_ADVISOR_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBGeneralPageParserAdvisorChatBody(req)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
      console.warn(`[Truly General Page Parser Advisor] HTTP ${resp.status}: ${errBody}`);
      return { ok: false, advice: null, raw: errBody, error: "parser_advisor_http_error" };
    }
    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || "").trim();
    const parsed = parseGeneralPageParserAdvisorAdvice(raw, req.request);
    if (!parsed.ok) {
      console.warn(`[Truly General Page Parser Advisor] ${parsed.error}:`, raw.slice(0, 240));
      return { ok: false, advice: null, raw: raw.slice(0, 1200), error: "parser_advisor_format_error" };
    }
    return { ok: true, advice: parsed.value, raw: raw.slice(0, 1200) };
  } catch (error) {
    console.warn("[Truly General Page Parser Advisor] error:", error);
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "parser_advisor_timeout"
      : "parser_advisor_network_error";
    return { ok: false, advice: null, error: code };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the configured Tier B OpenAI-compatible chat completions endpoint
 * with the deep-analysis
 * prompt and a (text, image[]) user message. Returns the parsed
 * `DeepClassification` or `null` on failure. Tolerant: any error
 * leaves Tier A unchanged on the caller side.
 *
 * Image-decode resilience: when the backend 400s with the python-side
 * "not enough values to unpack" / "image" error (which we've seen
 * fire for FB CDN URLs whose content the backend image decoder can't decode
 * — animated WebP, video thumbnails, signed URLs that 403 the
 * server-side fetcher), we retry once text-only. Better to ship a
 * partial result than a null one.
 */
export async function callTierBDeep(
  req: TierBDeepRequest,
): Promise<DeepClassification | null> {
  const result = await callTierBDeepDetailed(req);
  return result.ok ? result.deep : null;
}

export async function callTierBDeepDetailed(
  req: TierBDeepRequest,
): Promise<TierBDeepResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const filteredCount = req.filteredImageCount ?? 0;
  const sentImages = req.imageUrls.length > 0;

  const first = await postOnce(url, req, /*includeImages=*/ true);
  if (first.ok && first.value) {
    if (sentImages) first.value.imageStatus = "ok";
    else first.value.imageStatus = filteredCount > 0 ? "filtered" : "no_images";
    return { ok: true, deep: first.value };
  }

  if (first.retryTextOnly && sentImages) {
    console.warn(
      `[Truly Tier B] retry text-only after image path failure (was ${req.imageUrls.length} image(s))`,
    );
    const second = await postOnce(url, req, /*includeImages=*/ false);
    if (second.ok && second.value) {
      second.value.imageStatus = first.retryImageStatus ?? "decode_failed";
      return { ok: true, deep: second.value };
    }
    return {
      ok: false,
      deep: null,
      error: second.error ?? first.error ?? "tier_b_failed",
    };
  }
  return {
    ok: false,
    deep: null,
    error: first.error ?? "tier_b_failed",
  };
}

interface PostOutcome {
  ok: boolean;
  value: DeepClassification | null;
  error?: TierBDeepErrorCode | string;
  /** True when the failure looked like a backend image-decode crash and a
   *  text-only retry is worth attempting. */
  retryTextOnly: boolean;
  retryImageStatus?: NonNullable<DeepClassification["imageStatus"]>;
}

interface ParsedDeepContent {
  ok: boolean;
  value: DeepClassification | null;
  error?: string;
}

export function extractDeepJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  return candidate;
}

export function parseTierBDeepContent(raw: string, model: string, outputLang?: Lang): ParsedDeepContent {
  const jsonText = extractDeepJsonObject(raw);
  if (!jsonText) {
    return { ok: false, value: null, error: "no_strict_json_object" };
  }
  try {
    return { ok: true, value: normalizeDeep(JSON.parse(jsonText), model, outputLang) };
  } catch (e) {
    return {
      ok: false,
      value: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "bad_json",
    };
  }
}

async function postOnce(
  url: string,
  req: TierBDeepRequest,
  includeImages: boolean,
): Promise<PostOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_DEEP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBDeepChatBody(req, includeImages)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
      console.warn(`[Truly Tier B] HTTP ${resp.status}: ${errBody}`);
      // Classic Python-side image decode crash. Retry text-only.
      const looksLikeImageCrash =
        resp.status === 400 &&
        (errBody.includes("not enough values to unpack") ||
         errBody.includes("image") ||
         errBody.includes("PIL"));
      // When images caused the crash, log the URLs we sent so a future
      // pre-filter pattern can be designed against real samples. Only
      // logged when includeImages is true so retry calls stay quiet.
      if (looksLikeImageCrash && includeImages && req.imageUrls.length > 0) {
        for (const u of req.imageUrls) {
          console.warn(`[Truly Tier B] crash-url: ${u}`);
        }
      }
      return {
        ok: false,
        value: null,
        error: "tier_b_http_error",
        retryTextOnly: looksLikeImageCrash,
        retryImageStatus: looksLikeImageCrash ? "decode_failed" : undefined,
      };
    }
    const data = await resp.json();
    const choice = data?.choices?.[0];
    const raw = choice?.message?.content || "";
    const parsed = parseTierBDeepContent(raw, req.model, req.outputLang);
    if (!parsed.ok) {
      const reasoning = choice?.message?.reasoning || "";
      const finishReason = choice?.finish_reason;
      const error =
        finishReason === "length" && !raw && reasoning
          ? "tier_b_response_truncated"
          : !raw && reasoning
            ? "tier_b_reasoning_without_json"
            : "tier_b_format_error";
      console.warn(`[Truly Tier B] ${parsed.error}:`, raw.slice(0, 1200));
      return {
        ok: false,
        value: null,
        error,
        retryTextOnly: includeImages && req.imageUrls.length > 0,
        retryImageStatus: includeImages && req.imageUrls.length > 0
          ? "vision_format_failed"
          : undefined,
      };
    }
    return { ok: true, value: parsed.value, retryTextOnly: false };
  } catch (e) {
    console.warn("[Truly Tier B] error:", e);
    const error = e instanceof DOMException && e.name === "AbortError"
      ? "tier_b_timeout"
      : "tier_b_network_error";
    return { ok: false, value: null, error, retryTextOnly: false };
  } finally {
    clearTimeout(timer);
  }
}

function clampUnit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

export function normalizeDeep(raw: any, model: string, outputLang?: Lang): DeepClassification {
  const lang = tierBOutputLang(outputLang);
  const out: DeepClassification = { model, outputLang: lang };
  const aiLikelihood = clampUnit(raw.ai_likelihood ?? raw.aiLikelihood);
  const textAiLikelihood = clampUnit(raw.txt_ai ?? raw.text_ai_likelihood ?? raw.textAiLikelihood);
  const imageAiLikelihood = clampUnit(raw.img_ai ?? raw.image_ai_likelihood ?? raw.imageAiLikelihood);
  if (textAiLikelihood !== undefined) out.textAiLikelihood = textAiLikelihood;
  if (imageAiLikelihood !== undefined) out.imageAiLikelihood = imageAiLikelihood;
  const zhCnLexicalSignal = clampUnit(raw.zh ?? raw.zh_cn_lexical_signal ?? raw.zhCnLexicalSignal);
  if (zhCnLexicalSignal !== undefined) out.zhCnLexicalSignal = zhCnLexicalSignal;
  if (aiLikelihood !== undefined) out.aiLikelihood = aiLikelihood;
  else {
    const splitScores = [textAiLikelihood, imageAiLikelihood].filter((v): v is number => typeof v === "number");
    if (splitScores.length > 0) out.aiLikelihood = Math.max(...splitScores);
  }
  const commercialIntent = clampUnit(raw.com ?? raw.commercial_intent ?? raw.commercialIntent);
  if (commercialIntent !== undefined) out.commercialIntent = commercialIntent;
  const lowQualitySignal = clampUnit(raw.lq ?? raw.low_quality_signal ?? raw.lowQualitySignal);
  if (lowQualitySignal !== undefined) out.lowQualitySignal = lowQualitySignal;
  const iq = raw.information_quality && typeof raw.information_quality === "object"
    ? raw.information_quality
    : {};
  const hasInlineIq =
    raw.fr !== undefined ||
    raw.mr !== undefined ||
    raw.fc !== undefined ||
    raw.why !== undefined;
  if ((raw.information_quality && typeof raw.information_quality === "object") || hasInlineIq) {
    const informationQuality: NonNullable<DeepClassification["informationQuality"]> = {};
    const factualRisk = clampUnit(raw.fr ?? iq.factual_risk ?? iq.factualRisk);
    if (factualRisk !== undefined) informationQuality.factualRisk = factualRisk;
    const manipulationRisk = clampUnit(raw.mr ?? iq.manipulation_risk ?? iq.manipulationRisk);
    if (manipulationRisk !== undefined) informationQuality.manipulationRisk = manipulationRisk;
    if (typeof raw.fc === "boolean") informationQuality.needsFactCheck = raw.fc;
    else if (typeof iq.needs_fact_check === "boolean") informationQuality.needsFactCheck = iq.needs_fact_check;
    else if (typeof iq.needsFactCheck === "boolean") informationQuality.needsFactCheck = iq.needsFactCheck;
    const explanation = raw.why ?? iq.explanation;
    if (typeof explanation === "string" && explanation.trim().length > 0) {
      informationQuality.explanation = explanation.trim().slice(0, 80);
    }
    if (Object.keys(informationQuality).length > 0) {
      out.informationQuality = informationQuality;
    }
  }
  const rawImageInsights = Array.isArray(raw.imgs)
    ? raw.imgs
    : Array.isArray(raw.image_insights)
      ? raw.image_insights
      : [];
  if (rawImageInsights.length > 0) {
    const insights = rawImageInsights
      .filter((x: any) =>
        x &&
        (typeof x.note === "string" || typeof x.observation === "string")
      )
      .slice(0, 4)
      .map((x: any) => {
        const insight: NonNullable<DeepClassification["imageInsights"]>[number] = {
          observation: (typeof x.note === "string" ? x.note : x.observation).slice(0, 80),
        };
        const url = typeof x.u === "string" ? x.u : typeof x.url === "string" ? x.url : "";
        if (url.trim()) insight.url = url.trim();
        const index = typeof x.i === "number" ? x.i : typeof x.index === "number" ? x.index : undefined;
        if (typeof index === "number" && Number.isFinite(index)) {
          insight.index = Math.max(1, Math.min(4, Math.round(index)));
        }
        return insight;
      });
    if (insights.length > 0) out.imageInsights = insights;
  }
  const summary = raw.sum ?? raw.summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    out.summary = summary.trim().slice(0, 80);
  }
  return lang === "zh-TW" ? applyDeepOutputReview(out) : out;
}
