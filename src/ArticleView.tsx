import { useMemo } from "react";
import DOMPurify from "dompurify";
export type Article = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  cover_url: string | null;
  content: string;
  revision?: number;
  published_slug?: string | null;
  published_at?: string | null;
  updated_at?: string;
};
export default function ArticleView({ article }: { article: Article }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(article.content, {
        ADD_ATTR: ["target"],
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
      }),
    [article.content],
  );
  return (
    <article className="article-paper">
      <h1>{article.title || "Untitled article"}</h1>
      {article.excerpt && <p className="article-excerpt">{article.excerpt}</p>}
      {article.published_at && (
        <p className="article-date">
          Published{" "}
          {new Date(article.published_at).toLocaleDateString("en-PH", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}
      {article.cover_url && (
        <img className="article-cover" src={article.cover_url} alt="" />
      )}
      <div
        className="article-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
