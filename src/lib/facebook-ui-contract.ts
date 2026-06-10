export const FACEBOOK_COMMENT_THREAD_BOUNDARY_PATTERN =
  "^(?:查看更多留言|顯示更多留言|View more comments?|View previous comments?)$";

export const FACEBOOK_RELATIVE_TIME_TEXT_PATTERN =
  "^(?:剛剛|昨天|今天|Justnow|Yesterday|Today)$";

export const FACEBOOK_TIMESTAMP_ONLY_TEXT_PATTERN =
  "^(?=.{2,28}$)(?=.*\\d)(?=.*[年月日時小分秒上午下午天週周])[0-9年月日時小分秒上午下午天週周:：/.-]+$";

export const FACEBOOK_BYLINE_TIMESTAMP_TEXT_PATTERN =
  "^(?:追蹤|已追蹤|Follow|Following)?[0-9年月日時小分秒上午下午天週周:：/.-]{2,28}$";

export const FACEBOOK_NON_AUTHOR_CHROME_LABEL_PATTERN =
  "^(?:分享對象[:：]?.*|你的朋友|所有人|公開|朋友|只限本人|自訂|Public|Friends|Onlyme|Custom)$";

export function isFacebookCommentThreadBoundaryText(value: string): boolean {
  return new RegExp(FACEBOOK_COMMENT_THREAD_BOUNDARY_PATTERN, "i").test(value.trim());
}

export function looksLikeFacebookTimestampOnlyText(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (new RegExp(FACEBOOK_RELATIVE_TIME_TEXT_PATTERN, "i").test(compact)) return true;
  return new RegExp(FACEBOOK_TIMESTAMP_ONLY_TEXT_PATTERN, "i").test(compact);
}

export function looksLikeFacebookBylineChromeOnlyText(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return true;
  if (looksLikeFacebookTimestampOnlyText(compact)) return true;
  return new RegExp(FACEBOOK_BYLINE_TIMESTAMP_TEXT_PATTERN, "i").test(compact);
}

export function looksLikeFacebookNonAuthorChromeLabel(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return true;
  if (looksLikeFacebookTimestampOnlyText(compact)) return true;
  return new RegExp(FACEBOOK_NON_AUTHOR_CHROME_LABEL_PATTERN, "i").test(compact);
}
