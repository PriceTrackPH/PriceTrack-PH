import http from "node:http";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const collectorDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceExtensionDirectory = path.resolve(collectorDirectory, "..", "extension");
const profileDirectory = path.join(collectorDirectory, ".browser-profile");
const requestTimeoutMs = 45_000;

function loadEnvironment(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[name]) process.env[name] = value;
  }
}

async function loadLocalEnvironment() {
  try {
    loadEnvironment(await readFile(path.join(collectorDirectory, ".env.local"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function requestedLimit() {
  if (process.argv.includes("--all")) return Number.POSITIVE_INFINITY;
  const argument = process.argv.find((item) => item.startsWith("--limit="));
  const value = Number(argument?.split("=")[1] ?? 5);
  return Number.isSafeInteger(value) && value > 0 ? value : 5;
}

async function apiRequest(site, token, action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${site}/api/admin-pc-collector?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Collector API returned ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function prepareCollectorExtension(port) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pricetrack-pc-extension-"));
  await cp(sourceExtensionDirectory, temporaryDirectory, { recursive: true });

  const contentPath = path.join(temporaryDirectory, "content.js");
  const content = await readFile(contentPath, "utf8");
  const patched = content.replace(
    /fetch\(`\$\{PRICETRACK_SITE\}\/api\/observations`,\s*\{/,
    `fetch("http://127.0.0.1:${port}/observations", {`,
  );
  if (patched === content) throw new Error("Unable to connect the collector extension to the local runner.");
  await writeFile(contentPath, patched, "utf8");

  const manifestPath = path.join(temporaryDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.name = "PriceTrack PH PC Collector";
  manifest.host_permissions = Array.from(new Set([
    ...(manifest.host_permissions || []),
    "http://127.0.0.1/*",
  ]));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return temporaryDirectory;
}

function createRelay(site, token) {
  const waiters = new Map();
  const server = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/observations") {
      response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
      return;
    }

    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 512_000) {
        response.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Observation is too large" }));
        return;
      }
      chunks.push(chunk);
    }

    let observation;
    try {
      observation = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid observation" }));
      return;
    }

    const key = `${observation.shopId}:${observation.productId}`;
    try {
      const payload = await apiRequest(site, token, "record", { payload: observation });
      response.writeHead(payload.changed ? 201 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
      waiters.get(key)?.({ ok: true, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
      waiters.get(key)?.({ ok: false, error: message });
    }
  });

  return {
    server,
    waitFor(shopId, productId) {
      const key = `${shopId}:${productId}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(key);
          resolve({ ok: false, error: "Timed out waiting for Shopee product data" });
        }, requestTimeoutMs);
        waiters.set(key, (result) => {
          clearTimeout(timer);
          waiters.delete(key);
          resolve(result);
        });
      });
    },
  };
}

async function main() {
  await loadLocalEnvironment();
  const site = String(process.env.PRICETRACK_SITE || "https://pricetrackph.com").replace(/\/$/, "");
  const token = String(process.env.PRICETRACK_ADMIN_TOKEN || "").trim();
  if (!token || token === "paste_your_existing_admin_token_here") {
    throw new Error("Open pc-collector/.env.local and paste the same token used on the PriceTrack PH admin page.");
  }

  const limit = requestedLimit();
  const relay = createRelay(site, token);
  await new Promise((resolve, reject) => {
    relay.server.once("error", reject);
    relay.server.listen(0, "127.0.0.1", resolve);
  });
  const address = relay.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  if (!port) throw new Error("Unable to start the local observation relay.");

  const temporaryExtension = await prepareCollectorExtension(port);
  await mkdir(profileDirectory, { recursive: true });

  let browser;
  let currentProduct = null;
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    browser = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      args: [
        `--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`,
      ],
    });
    const page = browser.pages()[0] || await browser.newPage();
    let afterProductId = 0;
    let checked = 0;
    let succeeded = 0;
    let failed = 0;

    console.log(`PriceTrack PH PC Collector started (${Number.isFinite(limit) ? `${limit}-product test` : "all due products"}).`);
    console.log("Keep this window and the Chromium window open until the run finishes.\n");

    while (!interrupted && checked < limit) {
      const claim = await apiRequest(site, token, "claim", { afterProductId });
      currentProduct = claim.product;
      if (!currentProduct) break;
      afterProductId = currentProduct.productId;
      checked += 1;
      const label = `[${checked}${Number.isFinite(limit) ? `/${limit}` : ""}] ${currentProduct.shopId}.${currentProduct.externalProductId}`;
      process.stdout.write(`${label} checking... `);

      const resultPromise = relay.waitFor(currentProduct.shopId, currentProduct.externalProductId);
      try {
        await page.goto(currentProduct.productUrl, { waitUntil: "domcontentloaded", timeout: requestTimeoutMs });
      } catch {
        // The extension can still finish after Shopee's page navigation timeout.
      }
      const result = await resultPromise;
      if (result.ok) {
        succeeded += 1;
        const recorded = Number(result.payload?.recordedCount || 0);
        const unchanged = Number(result.payload?.unchangedCount || 0);
        console.log(`done (${recorded} changed, ${unchanged} unchanged)`);
      } else {
        failed += 1;
        console.log(`failed (${result.error})`);
        await apiRequest(site, token, "release", { productId: currentProduct.productId }).catch(() => {});
      }
      currentProduct = null;
      await page.waitForTimeout(1_000);
    }

    console.log(`\nFinished: ${succeeded} succeeded, ${failed} failed, ${checked} attempted.`);
    if (interrupted) console.log("The run was stopped safely. Run it again to continue with due products.");
  } finally {
    if (currentProduct) {
      await apiRequest(site, token, "release", { productId: currentProduct.productId }).catch(() => {});
    }
    await browser?.close().catch(() => {});
    await new Promise((resolve) => relay.server.close(resolve));
    await rm(temporaryExtension, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nCollector stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
