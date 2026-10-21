import { useEffect, useState } from "react";
import ArticleView, { type Article } from "./ArticleView";
import "./articles.css";
export default function Articles({ slug }: { slug?: string }) {
  const [articles, setArticles] = useState<Article[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/articles${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 404
              ? "Article not found."
              : "Unable to load articles. Please try again.",
          );
        return r.json();
      })
      .then((data) => setArticles(data.articles))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);
  useEffect(() => {
    document.title =
      slug && articles[0]
        ? `${articles[0].title} | PriceTrack PH`
        : "Articles | PriceTrack PH";
  }, [slug, articles]);
  return (
    <main className="public-articles-page"><div className="articles-shell public-articles-shell">

      <header className="public-articles-heading"><span>PRICETRACK PH ARTICLES</span>{slug ? <h2>Articles</h2> : <h1>Articles</h1>}</header>
      {loading ? (
        <p role="status">Loading articles…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : slug ? (
        articles[0] && <ArticleView article={articles[0]} />
      ) : (
        <>
          <div className="articles-list">
            {articles.map((a) => (
              <a
                className="article-card"
                key={a.id}
                href={`/articles/${a.slug}`}
              >
                {a.cover_url && <img src={a.cover_url} alt="" loading="lazy" />}
                <h2>{a.title}</h2>
                <p>{a.excerpt}</p>
                <span>
                  {a.published_at &&
                    new Date(a.published_at).toLocaleDateString("en-PH")}
                </span>
              </a>
            ))}
          </div>
          {!articles.length && <p>No articles published yet.</p>}
        </>
      )}
    </div></main>
  );
}
