import { useEffect, useRef, useState } from "react";
import ArticleView, { type Article } from "./ArticleView";
import DOMPurify from "dompurify";
import "./articles.css";
const empty = (): Article => ({
  title: "",
  slug: "",
  excerpt: "",
  cover_url: null,
  content: "",
});
const tokenKey = "pricetrack-admin-health-token";
const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120)
    .replace(/-$/, "");
export default function AdminArticles() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(tokenKey) || "",
  );
  const [draft, setDraft] = useState<Article>(empty),
    [list, setList] = useState<Article[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [mobilePreview, setMobilePreview] = useState(false),
    [loading, setLoading] = useState(false);
  const editor = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    imageTarget = useRef<"cover" | "inline">("cover"),
    selection = useRef<Range | null>(null);
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a:not([data-articles-link])"));
    if (links.length < 2) return;
    const [health, affiliate] = links;
    const originals = [health, affiliate].map(link => ({ text: link.textContent, href: link.getAttribute("href"), scroll: link.getAttribute("data-scroll-target") }));
    health.textContent = "Health";
    health.href = "/admin/health";
    health.removeAttribute("data-scroll-target");
    affiliate.textContent = "Affiliate";
    affiliate.href = "/admin/affiliate";
    affiliate.removeAttribute("data-scroll-target");
    const added = [["Collector", "/admin/collector"], ["Store Scanner", "/admin/store-scanner"], ["Settings", "/admin/settings"]].map(([title, href]) => {
      const link = document.createElement("a");
      link.textContent = title;
      link.href = href;
      return link;
    });
    affiliate.after(...added);
    const articles = document.querySelector("[data-articles-link]");
    articles?.setAttribute("aria-current", "page");
    return () => {
      added.forEach(link => link.remove());
      articles?.removeAttribute("aria-current");
      [health, affiliate].forEach((link, index) => {
        const original = originals[index];
        link.textContent = original.text;
        if (original.href === null) link.removeAttribute("href"); else link.setAttribute("href", original.href);
        if (original.scroll === null) link.removeAttribute("data-scroll-target"); else link.setAttribute("data-scroll-target", original.scroll);
      });
    };
  }, []);
  async function request(body?: object) {
    const response = await fetch("/api/admin-articles", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (response.status === 401) {
      sessionStorage.removeItem(tokenKey);
      setToken("");
    }
    if (!response.ok)
      throw new Error(data.error || "Unable to update articles.");
    return data;
  }
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    request()
      .then((d) => {
        if (active) setList(d.articles);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(() => {
    if (editor.current)
      editor.current.innerHTML = DOMPurify.sanitize(draft.content);
  }, [draft.id, preview]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        event.ctrlKey ||
        event.metaKey ||
        event.button !== 0 ||
        link.target === "_blank"
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin === location.origin &&
        url.pathname.startsWith("/admin") &&
        url.pathname !== location.pathname &&
        !window.confirm("Discard unsaved article edits?")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);
  function change(fields: Partial<Article>) {
    setDraft((d) => ({ ...d, ...fields }));
    setDirty(true);
    setMessage("");
  }
  function choose(article: Article) {
    if (dirty && !window.confirm("Discard unsaved edits?")) return;
    setDraft(article);
    setDirty(false);
    setPreview(false);
    setError("");
    setMessage("");
    if (editor.current)
      editor.current.innerHTML = DOMPurify.sanitize(article.content);
  }
  function remember() {
    const s = window.getSelection();
    if (s?.rangeCount && editor.current?.contains(s.anchorNode))
      selection.current = s.getRangeAt(0).cloneRange();
  }
  function command(name: string, value?: string) {
    editor.current?.focus();
    if (
      selection.current &&
      editor.current?.contains(selection.current.commonAncestorContainer)
    ) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(selection.current);
    }
    document.execCommand(name, false, value);
    change({ content: editor.current?.innerHTML || "" });
    remember();
  }
  async function persist() {
    const data = await request({
      action: "save",
      id: draft.id,
      revision: draft.revision,
      article: {
        ...draft,
        content: editor.current?.innerHTML ?? draft.content,
      },
    });
    const saved = {
      ...data.article,
      published_at: draft.published_at,
      published_slug: draft.published_slug,
    };
    setDraft(saved);
    setDirty(false);
    setList((rows) => [saved, ...rows.filter((a) => a.id !== saved.id)]);
    return saved;
  }
  async function run(action: "save" | "publish" | "unpublish") {
    if (
      action === "publish" &&
      !window.confirm("Publish this article for everyone to read?")
    )
      return;
    if (
      action === "unpublish" &&
      !window.confirm(
        "Remove this article from public view? Your draft will stay saved.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "unpublish") {
        await request({ action, id: draft.id });
        setDraft((d) => ({ ...d, published_at: null }));
        setList((rows) =>
          rows.map((a) =>
            a.id === draft.id ? { ...a, published_at: null } : a,
          ),
        );
        setMessage("Article unpublished.");
      } else {
        const saved = await persist();
        if (action === "publish") {
          const result = await request({
            action,
            id: saved.id,
            revision: saved.revision,
          });
          const updated = {
            ...saved,
            published_at: result.article.published_at,
            published_slug: result.article.slug,
          };
          setDraft(updated);
          setList((rows) => rows.map((a) => (a.id === saved.id ? updated : a)));
          setMessage("Article published.");
        } else setMessage("Draft saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update article.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        file.size > 2097152 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw new Error("Choose a JPG, PNG or WebP image, 2 MB or smaller.");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("Unable to read image."));
        r.readAsDataURL(file);
      });
      const result = await request({ action: "upload", mime: file.type, data });
      if (imageTarget.current === "cover") change({ cover_url: result.url });
      else {
        const alt =
          window.prompt(
            "Describe this image for readers using a screen reader:",
            "",
          ) || "";
        const img = document.createElement("img");
        img.src = result.url;
        img.alt = alt;
        command("insertHTML", img.outerHTML);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  }
  function pick(target: "cover" | "inline") {
    remember();
    imageTarget.current = target;
    imageInput.current?.click();
  }
  if (!token)
    return (
      <main className="health-page"><div className="health-shell articles-admin articles-shell">
        <div className="health-heading"><div><span className="health-kicker">PRIVATE ADMIN</span><h1>PriceTrack PH articles</h1></div></div>
        <p>Sign in with your existing admin password to manage articles.</p>
        <a href="/admin">Open admin sign-in</a>
      </div></main>
    );
  return (
    <main className="health-page">
      <div className="health-shell articles-admin articles-shell">
      <div className="health-heading">
        <div>
          <span className="health-kicker">PRIVATE ADMIN</span>
          <h1>PriceTrack PH articles</h1>
          <p>Write, save a draft, preview, then publish.</p>
        </div>
        <a href="/articles">View public articles ↗</a>
      </div>
      <div className="article-admin-grid">
        <aside className="health-events article-drafts-panel">
          <button disabled={busy} onClick={() => choose(empty())}>
            New article
          </button>
          {loading && <p role="status">Loading drafts…</p>}
          {list.map((a) => (
            <button
              className={`article-draft-link ${draft.id === a.id ? "active" : ""}`}
              key={a.id}
              disabled={busy}
              onClick={() => choose(a)}
            >
              <strong>{a.title}</strong>
              <span>
                {a.published_at ? "Published · draft available" : "Draft"}
              </span>
            </button>
          ))}
        </aside>
        <section className="health-events article-editor-panel">
          <div className="article-actions">
            <button disabled={busy} onClick={() => void run("save")}>
              Save draft
            </button>
            <button
              disabled={busy}
              onClick={() => {
                remember();
                setPreview((v) => !v);
              }}
            >
              {preview ? "Edit" : "Preview"}
            </button>
            <button
              className="article-publish"
              disabled={busy}
              onClick={() => void run("publish")}
            >
              {draft.published_at ? "Publish changes" : "Publish"}
            </button>
            {draft.published_at && (
              <>
                <button disabled={busy} onClick={() => void run("unpublish")}>
                  Unpublish
                </button>
                <a
                  href={`/articles/${draft.published_slug || draft.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View public article ↗
                </a>
              </>
            )}
          </div>
          <p role="status">
            {busy ? "Working…" : message || (dirty ? "Unsaved edits" : "")}
          </p>
          {error && (
            <p className="article-error" role="alert">
              {error}
            </p>
          )}
          {preview ? (
            <>
              <div className="article-preview-controls">
                <strong>Draft preview</strong>
                <button onClick={() => setMobilePreview((v) => !v)}>
                  {mobilePreview ? "Desktop width" : "Mobile width"}
                </button>
              </div>
              <div
                className={
                  mobilePreview ? "article-preview mobile" : "article-preview"
                }
              >
                <ArticleView article={draft} />
              </div>
            </>
          ) : (
            <fieldset disabled={busy} className="article-fields">
              <label>
                Title
                <input
                  maxLength={200}
                  value={draft.title}
                  onChange={(e) =>
                    change({
                      title: e.target.value,
                      ...(!draft.id && draft.slug === slugify(draft.title)
                        ? { slug: slugify(e.target.value) }
                        : {}),
                    })
                  }
                />
              </label>
              <label>
                URL name
                <input
                  value={draft.slug}
                  maxLength={120}
                  onChange={(e) => change({ slug: e.target.value })}
                />
                <small>/articles/{draft.slug || "your-article"}</small>
              </label>
              <label>
                Short description
                <textarea
                  maxLength={400}
                  value={draft.excerpt}
                  onChange={(e) => change({ excerpt: e.target.value })}
                />
              </label>
              <div className="article-actions">
                <button type="button" onClick={() => pick("cover")}>
                  Upload cover
                </button>
                {draft.cover_url && (
                  <button
                    type="button"
                    onClick={() => change({ cover_url: null })}
                  >
                    Remove cover
                  </button>
                )}
                <small>
                  JPG, PNG or WebP · up to 2 MB. Uploaded images use Supabase
                  Storage.
                </small>
              </div>
              {draft.cover_url && (
                <img
                  className="article-editor-cover"
                  src={draft.cover_url}
                  alt="Cover preview"
                />
              )}
              <div
                className="article-toolbar"
                role="toolbar"
                aria-label="Text formatting"
              >
                {[
                  ["bold", "Bold"],
                  ["italic", "Italic"],
                  ["underline", "Underline"],
                  ["insertUnorderedList", "Bullets"],
                  ["insertOrderedList", "Numbered"],
                  ["justifyLeft", "Left"],
                  ["justifyCenter", "Center"],
                  ["justifyRight", "Right"],
                ].map(([cmd, label]) => (
                  <button
                    type="button"
                    key={cmd}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => command(cmd)}
                  >
                    {label}
                  </button>
                ))}
                <label>
                  Style
                  <select
                    onPointerDown={remember}
                    value=""
                    onChange={(e) => command("formatBlock", e.target.value)}
                  >
                    <option value="" disabled>
                      Paragraph / heading
                    </option>
                    <option value="p">Paragraph</option>
                    <option value="h2">Heading 2</option>
                    <option value="h3">Heading 3</option>
                    <option value="blockquote">Quote</option>
                  </select>
                </label>
                <label>
                  Size
                  <select
                    value=""
                    onPointerDown={remember}
                    onChange={(e) => {
                      command("fontSize", "7");
                      editor.current
                        ?.querySelectorAll('font[size="7"]')
                        .forEach((n) => {
                          const el = n as HTMLElement;
                          el.style.fontSize = `${e.target.value}px`;
                          el.removeAttribute("size");
                        });
                      change({ content: editor.current?.innerHTML || "" });
                    }}
                  >
                    <option value="" disabled>
                      Text size
                    </option>
                    {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    remember();
                    const url = window.prompt("Link URL (https://…)");
                    if (url && /^https?:\/\//i.test(url))
                      command("createLink", url);
                  }}
                >
                  Link
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick("inline")}
                >
                  Image
                </button>
              </div>
              <div
                ref={editor}
                className="article-content article-editor"
                contentEditable={!busy}
                suppressContentEditableWarning
                role="textbox"
                aria-label="Article content"
                aria-multiline="true"
                onInput={() =>
                  change({ content: editor.current?.innerHTML || "" })
                }
                onKeyUp={remember}
                onMouseUp={remember}
                onPaste={(e) => {
                  e.preventDefault();
                  command("insertText", e.clipboardData.getData("text/plain"));
                }}
              />
            </fieldset>
          )}
        </section>
      </div>
      <input
        ref={imageInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0]);
        }}
      />
      </div>
    </main>
  );
}
