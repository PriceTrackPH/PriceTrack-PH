import crypto from "node:crypto";
import {
  authorizeArticles,
  validateArticle,
  articleRequest,
  articleConfig,
  articleHeaders,
  ARTICLE_BUCKET,
} from "./articles.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorizeArticles(req))
    return res
      .status(401)
      .json({ error: "Admin session expired. Sign in again." });
  if (!["GET", "POST"].includes(req.method))
    return res.status(405).json({ error: "Method not allowed" });
  try {
    if (req.method === "GET") {
      const [articles, published] = await Promise.all([
        articleRequest("articles?select=*&order=updated_at.desc&limit=100"),
        articleRequest("published_articles?select=id,slug,published_at"),
      ]);
      return res
        .status(200)
        .json({
          articles: articles.map((a) => ({
            ...a,
            published_at:
              published.find((p) => p.id === a.id)?.published_at || null,
            published_slug: published.find((p) => p.id === a.id)?.slug || null,
          })),
        });
    }
    if (JSON.stringify(req.body || {}).length > 3000000)
      return res.status(413).json({ error: "Upload or article is too large." });
    const { action, id, revision } = req.body || {};
    if (action === "upload") {
      const { mime, data } = req.body;
      const ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[mime];
      if (
        !ext ||
        typeof data !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      )
        return res
          .status(400)
          .json({ error: "Choose a JPG, PNG or WebP image." });
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > 2 * 1024 * 1024)
        return res
          .status(413)
          .json({ error: "Images must be 2 MB or smaller." });
      const signature =
        ext === "jpg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : ext === "png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP";
      if (!signature)
        return res
          .status(400)
          .json({ error: "The file does not match its image type." });
      const { url, key } = articleConfig();
      const name = `${crypto.randomUUID()}.${ext}`;
      const response = await fetch(
        `${url}/storage/v1/object/${ARTICLE_BUCKET}/${name}`,
        {
          method: "POST",
          headers: articleHeaders(key, { "Content-Type": mime }),
          body: bytes,
        },
      );
      if (!response.ok) throw new Error("Image upload failed.");
      return res
        .status(200)
        .json({
          url: `${url}/storage/v1/object/public/${ARTICLE_BUCKET}/${name}`,
        });
    }
    if (
      id &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return res.status(400).json({ error: "Invalid article." });
    if (action === "save") {
      let fields;
      try {
        fields = validateArticle(req.body.article);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const existing = !!id;
      if (existing && (!Number.isInteger(revision) || revision < 1))
        return res.status(400).json({ error: "Invalid draft revision." });
      const path = existing
        ? `articles?id=eq.${id}&revision=eq.${revision}`
        : "articles";
      const rows = await articleRequest(path, {
        method: existing ? "PATCH" : "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...fields,
          revision: existing ? revision + 1 : 1,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!rows.length)
        return res
          .status(409)
          .json({
            error:
              "This draft changed in another tab. Reload the draft before saving.",
          });
      return res.status(200).json({ article: rows[0] });
    }
    if (!id) return res.status(400).json({ error: "Save the draft first." });
    if (action === "publish") {
      if (!Number.isInteger(revision) || revision < 1)
        return res.status(400).json({ error: "Invalid draft revision." });
      const article = await articleRequest("rpc/publish_article", {
        method: "POST",
        body: JSON.stringify({ p_id: id, p_revision: revision }),
      });
      return res.status(200).json({ article });
    }
    if (action === "unpublish") {
      await articleRequest(`published_articles?id=eq.${id}`, {
        method: "DELETE",
      });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown article action." });
  } catch (error) {
    return res
      .status(error.status || 502)
      .json({ error: error.message || "Unable to update article." });
  }
}
