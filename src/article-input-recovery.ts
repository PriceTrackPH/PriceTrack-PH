import type { Article } from "./ArticleView";
export const articleInputsKey = "pricetrack-admin-article-inputs-v1";
const dayMs = 86400000;
const manilaOffsetMs = 8 * 60 * 60 * 1000;
export type ArticleInputRecovery = {
  version: 1;
  draft: Article;
  baseline: Article | null;
  expiresAt: number;
};
export function nextArticleInputReset(now = Date.now()) {
  const todayReset =
    Math.floor((now + manilaOffsetMs) / dayMs) * dayMs - manilaOffsetMs + 60000;
  return now < todayReset ? todayReset : todayReset + dayMs;
}
function validArticle(value: unknown): value is Article {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    ["title", "slug", "excerpt", "content"].every(
      (field) => typeof a[field] === "string",
    ) &&
    (a.cover_url === null || typeof a.cover_url === "string") &&
    (a.id === undefined || typeof a.id === "string") &&
    (a.revision === undefined || Number.isInteger(a.revision))
  );
}
export function clearArticleInputs(storage: Pick<Storage, "removeItem">) {
  try {
    storage.removeItem(articleInputsKey);
  } catch {
    /* Storage can be disabled. */
  }
}
export function readArticleInputs(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
): ArticleInputRecovery | null {
  try {
    const raw = storage.getItem(articleInputsKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      data.version === 1 &&
      validArticle(data.draft) &&
      (data.baseline === null || validArticle(data.baseline)) &&
      Number.isFinite(data.expiresAt) &&
      data.expiresAt > now &&
      data.expiresAt <= now + dayMs
    )
      return data;
  } catch {
    /* Invalid or unavailable storage is not a saved draft. */
  }
  clearArticleInputs(storage);
  return null;
}
export function writeArticleInputs(
  storage: Pick<Storage, "setItem">,
  data: ArticleInputRecovery,
) {
  try {
    storage.setItem(articleInputsKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
