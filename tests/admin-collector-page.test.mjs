import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("routes the protected collector admin page", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sections = await readFile(new URL("../src/SiteSections.tsx", import.meta.url), "utf8");
  assert.match(app, /pathname === "\/admin\/collector"/);
  assert.match(app, /<AdminCollector/);
  assert.match(sections, /"\/admin\/collector"/);
});

test("admin collector reuses one product tab and shows a numeric countdown", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.open\("about:blank", "ptph-admin-collector"\)/);
  assert.match(source, /Math\.max\(1, Math\.ceil\(waitMs \/ 1000\)\)/);
  assert.match(source, /Start collection/);
  assert.match(source, /Stop safely/);
});

test("admin collector polls completion for the exact claimed product", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /api<\{ completed: boolean \}>\("status"/);
  assert.match(source, /productId: product\.productId/);
  assert.match(source, /status\.completed/);
});
