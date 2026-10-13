import { publishedArticles } from "./articles.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const slug =
      typeof req.query?.slug === "string" ? req.query.slug : undefined;
    const articles = await publishedArticles(slug);
    if (slug && !articles.length)
      return res.status(404).json({ error: "Article not found" });
    return res.status(200).json({ articles });
  } catch {
    return res
      .status(503)
      .json({ error: "Unable to load articles. Please try again." });
  }
}
