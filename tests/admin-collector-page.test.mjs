import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("routes the protected collector admin page", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sections = await readFile(new URL("../src/SiteSections.tsx", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(app, /pathname === "\/admin\/collector"/);
  assert.match(app, /<AdminCollector/);
  assert.match(sections, /"\/admin\/collector"/);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/admin/collector" && rewrite.destination === "/"));
});

test("admin collector reuses one product tab and waits one second after recording", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.open\("about:blank", "ptph-admin-collector"\)/);
  assert.match(source, /consecutiveFailures = 0;\s+await wait\(1_000\);/);
  assert.doesNotMatch(source, /setMessage\(String\(Math\.max/);
  assert.match(source, /Start collection/);
  assert.match(source, /Stop collection/);
});

test("admin collector polls completion for the exact claimed product", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /api<\{ completed: boolean \}>\("status"/);
  assert.match(source, /productId: product\.productId/);
  assert.match(source, /status\.completed/);
});

test("admin collector saves and displays every stopped run", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /action=\$\{action\}/);
  assert.match(source, /api(?:<[^;]+>)?\("finish"/);
  assert.match(source, /Collection history/);
  assert.match(source, /Total running time/);
  assert.match(source, /Products remaining/);
  assert.match(source, /Stopped safely/);
});

test("collection history uses the same boxed table layout as recent events", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/precision-fix.css", import.meta.url), "utf8");
  assert.match(source, /className="health-events admin-collector-history"/);
  assert.match(source, /className="health-table-wrap"/);
  assert.match(source, /<table>/);
  assert.match(styles, /\.admin-collector-history\s*\{[^}]*margin-top:\s*24px;/);
});
