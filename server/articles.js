import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";
export const ARTICLE_BUCKET = "article-images";
export function authorizeArticles(req) {
  const expected = process.env.ADMIN_HEALTH_TOKEN || "";
  const supplied = String(req.headers?.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const a = Buffer.from(supplied),
    b = Buffer.from(expected);
  return !!expected && a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function articleConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!url || !key) throw new Error("Articles are not configured");
  return { url, key };
}
export function articleHeaders(key, extra = {}) {
  return {
    apikey: key,
    ...(key.startsWith("ey") ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}
export function safeArticleHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: [
      "p",
      "br",
      "div",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "img",
      "span",
      "font",
      "hr",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      font: ["size", "color"],
    },
    allowedSchemes: ["https", "http"],
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        "text-align": [/^(left|center|right|justify)$/],
        "font-size": [/^(1[2-9]|[2-3][0-9]|4[0-8])px$/],
        color: [/^#[0-9a-f]{3,8}$/i],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: "noopener noreferrer", target: "_blank" },
      }),
    },
  });
}
export function validSlug(slug) {
  return (
    typeof slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length <= 120
  );
}
export function validateArticle(input) {
  const title = String(input?.title || "")
    .trim()
    .slice(0, 200);
  const slug = String(input?.slug || "").trim();
  if (!title || !validSlug(slug))
    throw new Error(
      "Enter a title and a URL name using lowercase letters, numbers and hyphens.",
    );
  const content = safeArticleHtml(input.content);
  if (content.length > 200000) throw new Error("Article is too large.");
  const cover = String(input.cover_url || "").trim();
  if (cover && !/^https:\/\//i.test(cover))
    throw new Error("Cover image must use HTTPS.");
  return {
    title,
    slug,
    excerpt: String(input.excerpt || "")
      .trim()
      .slice(0, 400),
    cover_url: cover || null,
    content,
  };
}
export async function articleRequest(path, options = {}) {
  const { url, key } = articleConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: articleHeaders(key, {
      "Content-Type": "application/json",
      ...options.headers,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const conflict = detail.code === "40001";
    const invalidContent = detail.code === "22023";
    const error = new Error(
      conflict
        ? "This draft changed. Reload before publishing."
        : invalidContent
          ? "Write article content before publishing."
          : response.status === 409
            ? "This URL name is already used by another article."
            : "Unable to save or load articles.",
    );
    error.status =
      conflict || response.status === 409 ? 409 : invalidContent ? 400 : 502;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function publishedArticles(slug) {
  if (slug && !validSlug(slug)) return [];
  const query = new URLSearchParams({
    select: slug
      ? "*"
      : "id,title,slug,excerpt,cover_url,published_at,updated_at",
    order: "published_at.desc",
    limit: slug ? "1" : "100",
  });
  if (slug) query.set("slug", `eq.${slug}`);
  return articleRequest(`published_articles?${query}`);
}
