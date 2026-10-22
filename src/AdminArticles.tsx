import { useEffect, useRef, useState } from "react";
import ArticleView, { type Article } from "./ArticleView";
import DOMPurify from "dompurify";
import ArticleStyleMenu from "./ArticleStyleMenu";
import {
  clearArticleInputs,
  readArticleInputs,
  writeArticleInputs,
  nextArticleInputReset,
} from "./article-input-recovery";
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
function EditorIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    save: "M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-8h10v8",
    preview:
      "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    image: "M3 3h18v18H3V3zm0 14 6-6 4 4 3-3 5 5M8 7h.01",
    link: "m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
    publish: "M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7",
    insertUnorderedList: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    insertOrderedList:
      "M8 6h13M8 12h13M8 18h13M3 3v5M2 3h1M2 11h3l-3 5h3M2 18h3v3H2",
    justifyLeft: "M3 5h18M3 10h12M3 15h18M3 20h12",
    justifyCenter: "M3 5h18M6 10h12M3 15h18M6 20h12",
    justifyRight: "M3 5h18M9 10h12M3 15h18M9 20h12",
  };
  return (
    <svg
      aria-hidden="true"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.image} />
    </svg>
  );
}
export default function AdminArticles() {
  const [recoveredInputs] = useState(() => {
    try {
      return readArticleInputs(window.localStorage);
    } catch {
      return null;
    }
  });
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("p");
  const [selectedSize, setSelectedSize] = useState("17");
  const [token, setToken] = useState(
    () => sessionStorage.getItem(tokenKey) || "",
  );
  const [draft, setDraft] = useState<Article>(
      () => recoveredInputs?.draft || empty(),
    ),
    [list, setList] = useState<Article[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      recoveredInputs ? "Unsaved inputs restored from this browser." : "",
    ),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(!!recoveredInputs),
    [preview, setPreview] = useState(false),
    [mobilePreview, setMobilePreview] = useState(false),
    [loading, setLoading] = useState(false);
  const editor = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    imageTarget = useRef<"cover" | "inline">("cover"),
    selection = useRef<Range | null>(null);
  const inputExpiry = useRef(recoveredInputs?.expiresAt || 0);
  const savedBaseline = useRef<Article | null>(
    recoveredInputs?.baseline || null,
  );
  function clearTemporaryInputs() {
    try {
      clearArticleInputs(window.localStorage);
    } catch {
      /* Disabled storage. */
    }
    inputExpiry.current = 0;
  }
  function expireTemporaryInputs() {
    const saved = savedBaseline.current || empty();
    clearTemporaryInputs();
    setDraft(saved);
    setDirty(false);
    setPreview(false);
    setSelectedStyle("p");
    setSelectedSize("17");
    setRecoveryWarning("");
    if (editor.current)
      editor.current.innerHTML = DOMPurify.sanitize(saved.content);
    setMessage("Temporary inputs cleared at 12:01 AM Philippine time.");
  }
  useEffect(() => {
    if (!token) return;
    if (!dirty) {
      clearTemporaryInputs();
      setRecoveryWarning("");
      return;
    }
    if (!inputExpiry.current) inputExpiry.current = nextArticleInputReset();
    if (Date.now() >= inputExpiry.current) return;
    let kept = false;
    try {
      kept = writeArticleInputs(window.localStorage, {
        version: 1,
        draft,
        baseline: savedBaseline.current,
        expiresAt: inputExpiry.current,
      });
    } catch {
      /* Disabled storage. */
    }
    setRecoveryWarning(
      kept
        ? ""
        : "This browser could not keep your inputs. Use Save draft before leaving.",
    );
  }, [draft, dirty, token]);
  useEffect(() => {
    if (!token || !dirty || busy) return;
    const checkExpiry = () => {
      if (inputExpiry.current && Date.now() >= inputExpiry.current)
        expireTemporaryInputs();
    };
    const timer = window.setTimeout(
      checkExpiry,
      Math.max(0, inputExpiry.current - Date.now()),
    );
    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    checkExpiry();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkExpiry);
      document.removeEventListener("visibilitychange", checkExpiry);
    };
  }, [dirty, busy, token]);
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
        !window.confirm(
          "Leave this editor? Unsaved inputs stay in this browser until 12:01 AM Philippine time.",
        )
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
    clearTemporaryInputs();
    savedBaseline.current = article.id ? article : null;
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
    if (s?.rangeCount && editor.current?.contains(s.anchorNode)) {
      selection.current = s.getRangeAt(0).cloneRange();
      const element =
        s.anchorNode instanceof Element
          ? s.anchorNode
          : s.anchorNode?.parentElement;
      const block = element?.closest("h2,h3,blockquote");
      setSelectedStyle(
        block && editor.current.contains(block)
          ? block.tagName.toLowerCase()
          : "p",
      );
      if (element)
        setSelectedSize(
          String(
            Math.round(
              parseFloat(window.getComputedStyle(element).fontSize) || 17,
            ),
          ),
        );
    }
  }
  useEffect(() => {
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);
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
    clearTemporaryInputs();
    savedBaseline.current = saved;
    setDraft(saved);
    setDirty(false);
    setList((rows) => [saved, ...rows.filter((a) => a.id !== saved.id)]);
    return saved;
  }
  async function run(action: "save" | "publish" | "unpublish" | "delete") {
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
    if (action === "delete" && !window.confirm(`Permanently delete "${draft.title || 'Untitled article'}" and its published version, if any? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "delete") {
        await request({ action, id: draft.id, revision: draft.revision });
        clearTemporaryInputs();
        savedBaseline.current = null;
        setList(rows => rows.filter(a => a.id !== draft.id));
        setDraft(empty());
        setDirty(false);
        setPreview(false);
        if (editor.current) editor.current.innerHTML = "";
        setMessage("Article deleted.");
      } else if (action === "unpublish") {
        await request({ action, id: draft.id });
        if (savedBaseline.current)
          savedBaseline.current = {
            ...savedBaseline.current,
            published_at: null,
            published_slug: null,
          };
        setDraft((d) => ({ ...d, published_at: null, published_slug: null }));
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
          savedBaseline.current = updated;
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
      <main className="health-page">
        <div className="health-shell articles-admin articles-shell">
          <div className="health-heading">
            <div>
              <span className="health-kicker">PRIVATE ADMIN</span>
              <h1>PriceTrack PH articles</h1>
            </div>
          </div>
          <p>Sign in with your existing admin password to manage articles.</p>
          <a href="/admin">Open admin sign-in</a>
        </div>
      </main>
    );
  return (
    <main className="health-page article-admin-page">
      <div className="health-shell articles-admin articles-shell">
        <div className="health-heading">
          <div>
            <span className="health-kicker">PRIVATE ADMIN</span>
            <h1>PriceTrack PH articles</h1>
            <p>Write, save a draft, preview, then publish.</p>
          </div>
        </div>
        <div className="article-admin-grid">
          <aside className="health-events article-drafts-panel">
            <div className="article-drafts-heading">
              <h2>Drafts</h2>
              <button disabled={busy} onClick={() => choose(empty())}>
                <span aria-hidden="true">＋</span> New article
              </button>
            </div>
            {!loading && !list.length && (
              <p className="article-drafts-empty">
                Your saved drafts will appear here.
              </p>
            )}
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
                  {a.published_at ? "Published" : "Draft"}
                  {a.updated_at &&
                    ` · Updated ${new Date(a.updated_at).toLocaleDateString("en-PH")}`}
                </span>
              </button>
            ))}
          </aside>
          <section className="health-events article-editor-panel">
            <div className="article-actions article-editor-actions">
              <button disabled={busy} onClick={() => void run("save")}>
                <EditorIcon name="save" /> Save draft
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  remember();
                  setPreview((v) => !v);
                }}
              >
                <EditorIcon name="preview" /> {preview ? "Edit" : "Preview"}
              </button>
              <span className="article-save-status" role="status">
                <span aria-hidden="true">●</span>{" "}
                {busy
                  ? "Working…"
                  : message ||
                    `${draft.published_at ? "Published" : "Draft"} · ${dirty ? "Unsaved changes" : draft.id ? "Saved" : "New article"}`}
              </span>
              <button
                className="article-publish"
                disabled={busy}
                onClick={() => void run("publish")}
              >
                <EditorIcon name="publish" />{" "}
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
              {draft.id && <button className="article-delete" disabled={busy} onClick={() => void run("delete")}>Delete article</button>}
            </div>
            <p
              className="article-input-retention"
              role={recoveryWarning ? "alert" : undefined}
            >
              {recoveryWarning ||
                "Unsaved inputs stay in this browser until 12:01 AM Philippine time. Use Save draft to keep them for later."}
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
                <label className="article-field-row">
                  <span>Title</span>
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
                <label className="article-field-row">
                  <span>URL name</span>
                  <span className="article-url-field">
                    <span aria-hidden="true">/articles/</span>
                    <input
                      value={draft.slug}
                      maxLength={120}
                      onChange={(e) => change({ slug: e.target.value })}
                    />
                  </span>
                </label>
                <label className="article-field-row">
                  <span>Short description</span>
                  <span className="article-description-field">
                    <textarea
                      maxLength={400}
                      value={draft.excerpt}
                      onChange={(e) => change({ excerpt: e.target.value })}
                    />
                    <small>{draft.excerpt.length}/400</small>
                  </span>
                </label>
                <div className="article-field-row article-cover-row">
                  <span>Cover image</span>
                  <div className="article-actions">
                    <button
                      className="article-upload-cover"
                      type="button"
                      onClick={() => pick("cover")}
                    >
                      <EditorIcon name="image" /> Upload cover
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
                      Recommended 1200 × 630 · JPG, PNG or WebP · Max 2 MB
                    </small>
                  </div>
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
                      className={`article-format-icon format-${cmd}`}
                      aria-label={label}
                      title={label}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => command(cmd)}
                    >
                      {cmd === "bold" ? (
                        <strong>B</strong>
                      ) : cmd === "italic" ? (
                        <em>I</em>
                      ) : cmd === "underline" ? (
                        <u>U</u>
                      ) : (
                        <EditorIcon name={cmd} />
                      )}
                    </button>
                  ))}
                  <ArticleStyleMenu
                    value={selectedStyle}
                    disabled={busy}
                    rememberSelection={remember}
                    onChange={(value) => {
                      command("formatBlock", value);
                      setSelectedStyle(value);
                    }}
                  />
                  <label className="article-size-picker">
                    <span className="article-sr-only">Text size</span>
                    <select
                      aria-label="Text size"
                      value={selectedSize}
                      onPointerDown={remember}
                      onChange={(e) => {
                        const size = e.target.value;
                        command("fontSize", "7");
                        editor.current
                          ?.querySelectorAll('font[size="7"]')
                          .forEach((n) => {
                            const el = n as HTMLElement;
                            el.style.fontSize = `${size}px`;
                            el.removeAttribute("size");
                          });
                        change({ content: editor.current?.innerHTML || "" });
                        setSelectedSize(size);
                      }}
                    >
                      {![
                        "12",
                        "14",
                        "16",
                        "17",
                        "18",
                        "20",
                        "24",
                        "28",
                        "32",
                        "40",
                        "48",
                      ].includes(selectedSize) && (
                        <option value={selectedSize}>{selectedSize} px</option>
                      )}
                      {[12, 14, 16, 17, 18, 20, 24, 28, 32, 40, 48].map(
                        (size) => (
                          <option key={size} value={size}>
                            {size} px
                          </option>
                        ),
                      )}
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
                    <EditorIcon name="link" /> Link
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick("inline")}
                  >
                    <EditorIcon name="image" /> Image
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
                  data-placeholder="Start writing your article…"
                  onInput={() =>
                    change({ content: editor.current?.innerHTML || "" })
                  }
                  onKeyUp={remember}
                  onMouseUp={remember}
                  onPaste={(e) => {
                    e.preventDefault();
                    command(
                      "insertText",
                      e.clipboardData.getData("text/plain"),
                    );
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
