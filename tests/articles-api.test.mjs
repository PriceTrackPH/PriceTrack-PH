import test from "node:test";
import assert from "node:assert/strict";
import admin from "../server/article-admin-handler.js";
import publicHandler from "../server/article-public-handler.js";
import { safeArticleHtml, validateArticle } from "../server/articles.js";
const invoke = async (handler, req) => {
  const result = {};
  const res = {
    setHeader() {},
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await handler(req, res);
  return result;
};
process.env.ADMIN_HEALTH_TOKEN = "article-test-token";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
const headers = { authorization: "Bearer article-test-token" };
test("article content rejects scripts, event handlers, unsafe URLs and styles", () => {
  const html = safeArticleHtml(
    '<script>alert(1)</script><p style="font-size:24px;position:fixed">Hello</p><img src="javascript:alert(1)" onerror="alert(1)"><a href="https://example.org">Link</a>',
  );
  assert.doesNotMatch(html, /script|onerror|position|javascript/);
  assert.match(html, /font-size:24px/);
  assert.match(html, /noopener noreferrer/);
  assert.throws(() => validateArticle({ title: "Hello", slug: "../private" }));
});
test("anonymous visitors cannot read drafts, publish or upload", async () => {
  for (const method of ["GET", "POST"])
    assert.equal(
      (
        await invoke(admin, {
          method,
          headers: {},
          body: { action: "publish" },
        })
      ).status,
      401,
    );
});
test("public API reads published snapshots only, including unknown article 404", async () => {
  const old = global.fetch;
  try {
    global.fetch = async (url) => {
      assert.match(url, /\/published_articles\?/);
      assert.doesNotMatch(url, /\/articles\?/);
      return new Response("[]");
    };
    assert.equal(
      (
        await invoke(publicHandler, {
          method: "GET",
          query: { slug: "missing" },
        })
      ).status,
      404,
    );
  } finally {
    global.fetch = old;
  }
});
test("saving sanitizes content and rejects lost updates", async () => {
  const old = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /revision=eq.1/);
      const saved = JSON.parse(options.body);
      assert.equal(saved.revision, 2);
      assert.doesNotMatch(saved.content, /onerror/);
      return new Response("[]");
    };
    const result = await invoke(admin, {
      method: "POST",
      headers,
      body: {
        action: "save",
        id: "12345678-1234-1234-1234-123456789abc",
        revision: 1,
        article: {
          title: "Hello",
          slug: "hello",
          content: '<img src="https://example.org/a.png" onerror="alert(1)">',
        },
      },
    });
    assert.equal(result.status, 409);
  } finally {
    global.fetch = old;
  }
});
test("publish reports stale revision and empty content errors", async () => {
  const old = global.fetch;
  try {
    for (const [code, status] of [
      ["40001", 409],
      ["22023", 400],
    ]) {
      global.fetch = async () =>
        new Response(JSON.stringify({ code }), { status: 400 });
      assert.equal(
        (
          await invoke(admin, {
            method: "POST",
            headers,
            body: {
              action: "publish",
              id: "12345678-1234-1234-1234-123456789abc",
              revision: 1,
            },
          })
        ).status,
        status,
      );
    }
  } finally {
    global.fetch = old;
  }
});
test("uploads reject disguised files and oversize images", async () => {
  for (const [data, status] of [
    [Buffer.from("not an image").toString("base64"), 400],
    [Buffer.alloc(2097153).toString("base64"), 413],
  ])
    assert.equal(
      (
        await invoke(admin, {
          method: "POST",
          headers,
          body: { action: "upload", mime: "image/png", data },
        })
      ).status,
      status,
    );
});
test('delete requires admin, an article ID, and the current revision',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';const req={method:'POST',headers,body:{action:'delete',id,revision:2}};
 assert.equal((await invoke(admin,{...req,headers:{}})).status,401);
 assert.equal((await invoke(admin,{...req,body:{action:'delete',id}})).status,400);
 const old=global.fetch;let found=true;
 global.fetch=async(url,opts)=>{assert.equal(opts.method,'DELETE');assert.equal(new URL(url).searchParams.get('id'),`eq.${id}`);assert.equal(new URL(url).searchParams.get('revision'),'eq.2');return Response.json(found?[{id}]:[]);};
 try{assert.equal((await invoke(admin,req)).status,200);found=false;assert.equal((await invoke(admin,req)).status,409);}finally{global.fetch=old;}
});
