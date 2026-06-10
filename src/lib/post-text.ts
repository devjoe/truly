import {
  FACEBOOK_COMMENT_THREAD_BOUNDARY_PATTERN,
} from "./facebook-ui-contract";

export interface PostTextIdentity {
  authorName?: string | null;
  sourceName?: string | null;
}

export interface FacebookImageTextSplit {
  bodyText: string;
  /** Text visibly embedded in an image, usually from Facebook's OCR-style alt. */
  imageTexts: string[];
  /** Facebook-generated visual description alt text, not authored post text. */
  imageAltTexts: string[];
}

const FB_UI_CHROME_PATTERNS = [
  "查看更多",
  "顯示更多",
  "顯示較少",
  "查看全文",
  "收起",
  "See more",
  "See less",
  "Show more",
  "Show less",
  "さらに表示",
  "表示を減らす",
  "더 보기",
  "간략히 보기",
];

function normalizeIdentityName(raw: string): string {
  let s = raw.trim();
  s = s.replace(
    /\s*(已驗證帳號|已验证账号|已驗證|Verified|追蹤|Follow|加入|Join|關注)\s*/g,
    " ",
  );
  s = s.split(/[·•──✓\u00b7]/)[0];
  return s.replace(/\s+/g, " ").trim();
}

function identityLineMatches(line: string, value: string): boolean {
  if (!value) return false;
  const normalizedLine = normalizeIdentityName(line);
  if (line === value || normalizedLine === value) return true;
  return (
    line.startsWith(`${value} ·`) ||
    line.startsWith(`${value} •`) ||
    normalizedLine.startsWith(`${value} ·`) ||
    normalizedLine.startsWith(`${value} •`)
  );
}

function identityNames(identity: PostTextIdentity): string[] {
  const names = [identity.sourceName, identity.authorName]
    .map((name) => (name ? normalizeIdentityName(name) : ""))
    .filter((name) => name.length >= 2);
  return [...new Set(names)];
}

function stripLeadingIdentityPrefix(line: string, names: string[]): string {
  let out = line.trim();
  for (let pass = 0; pass < names.length + 2; pass += 1) {
    let changed = false;
    for (const name of names) {
      if (!out.startsWith(name)) continue;
      const next = out.charAt(name.length);
      if (next && !/\s|[·•:：-]/.test(next)) continue;
      out = out.slice(name.length).replace(/^[\s·•:：-]+/, "").trim();
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

function stripLeadingBylineChrome(line: string): string {
  return line
    .replace(/^(?:管理員|社團專家|保持發言的成員|最常發言的成員|熱衷發言的成員|版主|Admin|Moderator|Group expert|Top contributor)\s*/i, "")
    .trim();
}

function looksLikeObfuscatedFacebookTime(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  const shortTokens = tokens.filter((token) => token.length <= 2).length;
  return tokens.length >= 12 && shortTokens >= 10 && /[時小天週月日分秒]/.test(line);
}

function stripLeadingInlineBylineChrome(line: string): string {
  const segments = line.split(/\s*·\s*/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 3) return line;
  const bodyIndex = segments.findIndex((segment, index) =>
    index > 0 && index < segments.length - 1 && looksLikeObfuscatedFacebookTime(segment)
  );
  if (bodyIndex < 0) return line;
  return segments.slice(bodyIndex + 1).join(" · ").trim();
}

function looksLikeUnknownSourcePrefix(prefix: string): boolean {
  if (/^我是.{1,12}人$/.test(prefix)) return true;
  return /(社團|討論區|交流|中心|貼圖區|新聞|News|Taiwan|Club|Group|AI|技術|協會|譯站|論壇|社群)/i.test(prefix);
}

function stripUnknownSourceBeforeAuthor(line: string, authorName: string | undefined): string {
  const author = authorName ? normalizeIdentityName(authorName) : "";
  if (!author) return line;
  const idx = line.indexOf(author);
  if (idx <= 0 || idx > 80) return line;
  const prefix = line.slice(0, idx).trim();
  const rest = line.slice(idx + author.length).replace(/^[\s·•:：-]+/, "").trim();
  if (prefix.length < 2 || rest.length < 2) return line;
  if (/[。！？!?，,；;]/.test(prefix)) return line;
  if (!looksLikeUnknownSourcePrefix(prefix)) return line;
  return rest;
}

export function stripLeadingPostIdentity(text: string, identity: PostTextIdentity): string {
  const names = identityNames(identity);
  const authorName = identity.authorName ? normalizeIdentityName(identity.authorName) : "";
  if (names.length === 0 && !authorName) return text.trim();

  const lines = text.split(/\r?\n/);
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (!line) {
      idx += 1;
      continue;
    }
    if (names.some((name) => identityLineMatches(line, name))) {
      idx += 1;
      continue;
    }
    if (
      !identity.sourceName &&
      authorName &&
      looksLikeUnknownSourcePrefix(line) &&
      idx + 1 < lines.length &&
      identityLineMatches(lines[idx + 1].trim(), authorName)
    ) {
      idx += 2;
      continue;
    }
    const stripped = stripLeadingIdentityPrefix(line, names);
    if (stripped !== line) {
      if (!stripped) {
        idx += 1;
        continue;
      }
      lines[idx] = stripped;
    }
    if (!identity.sourceName) {
      const unknownSourceStripped = stripUnknownSourceBeforeAuthor(lines[idx].trim(), authorName);
      if (unknownSourceStripped !== lines[idx].trim()) {
        lines[idx] = unknownSourceStripped;
      }
    }
    const inlineBylineStripped = stripLeadingInlineBylineChrome(lines[idx].trim());
    if (inlineBylineStripped !== lines[idx].trim()) {
      lines[idx] = inlineBylineStripped;
    }
    const bylineStripped = stripLeadingBylineChrome(lines[idx].trim());
    if (bylineStripped !== lines[idx].trim()) {
      if (!bylineStripped) {
        idx += 1;
        continue;
      }
      lines[idx] = bylineStripped;
    }
    break;
  }

  return lines.slice(idx).join("\n").trim();
}

function stripTrailingSourceAttributionChrome(text: string, identity?: PostTextIdentity): string {
  if (!identity) return text;
  const sourceName = identity.sourceName ? normalizeIdentityName(identity.sourceName) : "";
  const authorName = identity.authorName ? normalizeIdentityName(identity.authorName) : "";
  if (!sourceName && !authorName) return text;

  return text.replace(/\s+來源：([^。！？!?]{2,180})$/u, (match, rawTail: string) => {
    const tail = normalizeIdentityName(rawTail);
    const hasKnownIdentity =
      Boolean(sourceName && tail.includes(sourceName)) ||
      Boolean(authorName && tail.includes(authorName));
    const hasFacebookDate = /(?:\d{1,2}月\d{1,2}日|\d+\s*(?:秒|分鐘|小時|天|週|月|年)|昨天|今天|剛剛)$/i.test(tail);
    return hasKnownIdentity && hasFacebookDate ? "" : match;
  }).trim();
}

function stripCommentThreadTail(text: string): string {
  const boundaryPattern = FACEBOOK_COMMENT_THREAD_BOUNDARY_PATTERN
    .replace(/^\^/, "")
    .replace(/\$$/, "");
  return text.replace(
    new RegExp(`(?:^|[\\s\\r\\n])${boundaryPattern}[\\s\\S]*$`, "i"),
    "",
  ).trim();
}

function stripRecommendationFeedbackTail(text: string): string {
  return text.replace(
    /(?:^|[\s\r\n])(?:你對這[則篇]貼文有興趣嗎[？?]?)[\s\S]*$/i,
    "",
  ).trim();
}

function stripGeneratedObservationLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) =>
      !/^\s*(?:AI\s*)?(?:圖片|圖像|影像|Image)\s*(?:觀察|判讀|分析|observation|analysis)s?\s*[：:]/i.test(line)
    )
    .join("\n")
    .trim();
}

export function cleanFacebookUiChrome(text: string): string {
  let out = stripGeneratedObservationLines(stripRecommendationFeedbackTail(stripCommentThreadTail(text)))
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(/(?:^|\s)(?:回答|回覆)?\s*查看(?:全部)?\s*\d+\s*則(?:回覆|留言|留言回覆)(?=$|\s)/gi, " ");
    out = out.replace(/(?:^|\s)(?:回答|回覆)(?=$|\s)/g, " ");
    out = out.replace(/(?:^|\s)(?:的\s*)?(?:圖像|影像|圖片|相片|照片)(?=$|[。.!！?？\s])/g, " ");
    for (const phrase of FB_UI_CHROME_PATTERNS) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out
        .replace(new RegExp(`(?:[.。…⋯]{0,6}\\s*)?${escaped}\\s*`, "gi"), " ")
        .trim();
    }
    out = out.replace(/\s+/g, " ").trim();
    if (out === before) break;
  }
  return out;
}

export function cleanAuthoredPostText(text: string, identity?: PostTextIdentity): string {
  return cleanFacebookUiChrome(stripTrailingSourceAttributionChrome(cleanFacebookUiChrome(text), identity));
}

export function splitFacebookImageAltText(raw: string): FacebookImageTextSplit {
  const imageTexts: string[] = [];
  const imageAltTexts: string[] = [];
  const seen = new Set<string>();
  const source = raw.replace(/[\u200e\u200f\u202a-\u202e]/g, "");

  const add = (bucket: string[], text: string): void => {
    const clean = cleanFacebookUiChrome(text)
      .replace(/^[\s，,、：:]+|[\s，,、：:]+$/g, "")
      .trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    bucket.push(clean);
  };

  let bodyText = source.replace(
    /可能是[^。！？\n]{0,160}?顯示的文字是「((?:[^」]|」(?!的圖像|的影像|的圖片)){2,2000})」(?:的圖像|的影像|的圖片)/g,
    (_match, text: string) => {
      add(imageTexts, text);
      return " ";
    },
  );

  bodyText = bodyText.replace(
    /可能是[^。！？\n]{0,160}?顯示的文字是「([^」]{2,2000})」/g,
    (_match, text: string) => {
      add(imageTexts, text);
      return " ";
    },
  );

  bodyText = bodyText.replace(
    /(?:的插圖\s*)?可能是[^。！？\n]{0,160}?顯示的文字是「([^」]{2,2000})$/g,
    (_match, text: string) => {
      add(imageTexts, text);
      return " ";
    },
  );

  bodyText = bodyText.replace(
    /(^|[\s\n])「((?:[^」]|」(?!的圖像|的影像|的圖片)){2,2000})」(?:的圖像|的影像|的圖片)/g,
    (_match, prefix: string, text: string) => {
      add(imageTexts, text);
      return prefix;
    },
  );

  bodyText = bodyText.replace(
    /可能是([^。！？\n]{1,160})(?:的)?(?:圖像|影像|圖片|相片|照片)/g,
    (_match, text: string) => {
      add(imageAltTexts, text.replace(/的$/, ""));
      return " ";
    },
  );

  bodyText = bodyText.replace(/(?:^|\s)(?:的\s*)?(?:圖像|影像|圖片|相片|照片)(?=$|[。.!！?？\s])/g, " ");

  return {
    bodyText: cleanFacebookUiChrome(bodyText),
    imageTexts,
    imageAltTexts,
  };
}
