import test from "node:test";
import assert from "node:assert/strict";
import {
  articleInputsKey,
  nextArticleInputReset,
  readArticleInputs,
  writeArticleInputs,
} from "../src/article-input-recovery.ts";
const draft = {
  title: "Unfinished guide",
  slug: "unfinished-guide",
  excerpt: "Temporary text",
  content: "<p>Work in progress</p>",
  cover_url: "https://example.org/image.png",
};
function store() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
test("Philippine reset is 12:01 AM, including the minute after midnight", () => {
  for (const [now, expiry] of [
    ["2026-10-13T19:00:00+08:00", "2026-10-14T00:01:00+08:00"],
    ["2026-10-14T00:00:30+08:00", "2026-10-14T00:01:00+08:00"],
    ["2026-10-14T00:01:00+08:00", "2026-10-15T00:01:00+08:00"],
    ["2026-12-31T23:59:00+08:00", "2027-01-01T00:01:00+08:00"],
    ["2028-02-28T23:59:00+08:00", "2028-02-29T00:01:00+08:00"],
  ])
    assert.equal(nextArticleInputReset(Date.parse(now)), Date.parse(expiry));
});
test("unfinished fields, images and saved baseline survive reload until reset", () => {
  const storage = store(),
    now = Date.parse("2026-10-13T19:00:00+08:00"),
    expiresAt = nextArticleInputReset(now);
  const baseline = {
    ...draft,
    id: "saved-draft",
    content: "<p>Saved version</p>",
    revision: 1,
  };
  const data = {
    version: 1,
    draft: { ...draft, id: "saved-draft" },
    baseline,
    expiresAt,
  };
  assert.equal(writeArticleInputs(storage, data), true);
  assert.deepEqual(readArticleInputs(storage, expiresAt - 1), data);
  assert.equal(readArticleInputs(storage, expiresAt), null);
  assert.equal(storage.getItem(articleInputsKey), null);
  assert.equal(baseline.content, "<p>Saved version</p>");
});
test("invalid storage and quota failures do not masquerade as saved drafts", () => {
  const storage = store();
  storage.setItem(articleInputsKey, "invalid json");
  assert.equal(readArticleInputs(storage), null);
  assert.equal(storage.getItem(articleInputsKey), null);
  assert.equal(
    writeArticleInputs(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      { version: 1, draft, baseline: null, expiresAt: nextArticleInputReset() },
    ),
    false,
  );
});
