import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const collectorDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const port = 47321;
const requestTimeoutMs = 60_000;
const productTimeoutMs = 75_000;

function loadEnvironment(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[name]) process.env[name] = value;
  }
}

async function loadLocalEnvironment() {
  try { loadEnvironment(await readFile(path.join(collectorDirectory, ".env.local"), "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function requestedLimit() {
  if (process.argv.includes("--all")) return Number.POSITIVE_INFINITY;
  const argument = process.argv.find((item) => item.startsWith("--limit="));
  const value = Number(argument?.split("=")[1] ?? 5);
  return Number.isSafeInteger(value) && value > 0 ? value : 5;
}

function safeDelay() {
  const value = Number(process.env.PRICETRACK_PRODUCT_DELAY_SECONDS || 3);
  return Number.isFinite(value) && value >= 3 ? Math.round(value * 1000) : 3_000;
}

function findWindowsChrome() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

async function apiRequest(site, token, action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${site}/api/admin-pc-collector?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}), signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Collector API returned ${response.status}`);
    return payload;
  } finally { clearTimeout(timer); }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Cache-Control": "no-store",
    "Content-Type": "application/json",
  }).end(status === 204 ? undefined : JSON.stringify(body));
}

async function readJson(request, maximumBytes = 512_000) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function controllerHtml(limit, delayMs) {
  const label = Number.isFinite(limit) ? `${limit}-product test` : "all due products";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PriceTrack PH Regular Chrome Collector</title>
<style>:root{color-scheme:dark;font-family:Arial,sans-serif}body{max-width:760px;margin:48px auto;padding:0 20px;background:#101614;color:#f5f2e9}.card{border:1px solid #33403c;border-radius:18px;padding:26px;background:#151d1a}h1{margin:6px 0;font-size:30px}.accent{color:#00f8b9}.muted{color:#aeb9b5;line-height:1.5}button{border:0;border-radius:10px;padding:13px 20px;font-weight:700;background:#281b6b;color:white;cursor:pointer}button[disabled]{opacity:.5;cursor:not-allowed}.status{margin-top:22px;padding:18px;border-radius:12px;background:#0c1210;white-space:pre-wrap;line-height:1.55}.warning{margin-top:18px;color:#f3d486}</style></head>
<body><div class="card"><div class="accent">PRIVATE LOCAL COLLECTOR</div><h1>Regular Chrome collection</h1><p class="muted">Mode: ${label}.</p><button id="start">Start collection</button> <button id="stop" disabled>Stop safely</button><div id="status" class="status">Ready. Click Start once and keep the dedicated Shopee tab open.</div><p class="warning">If Shopee displays verification, do not bypass it. Collection pauses after two consecutive timeouts.</p></div>
<script>
const startButton=document.querySelector('#start'),stopButton=document.querySelector('#stop'),statusBox=document.querySelector('#status');let productTab=null,stopped=false;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,options={}){const response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(body.error||('Request failed '+response.status));error.status=response.status;error.body=body;throw error}return body}
function render(state){const runTotal=state.limit===null?state.totalDue:Math.min(state.limit,state.totalDue);const processing=state.currentProduct?1:0;const done=Math.max(0,state.totalTracked-state.totalDue)+state.succeeded;const left=Math.max(0,state.totalTracked-done);statusBox.textContent=['Total products: '+state.totalTracked,'Done: '+done+' / '+state.totalTracked,'Left: '+left+' / '+state.totalTracked,'Currently processing: '+processing,'Remaining in this run: '+Math.max(0,runTotal-state.succeeded-state.failed-processing),'Succeeded this run: '+state.succeeded,'Failed this run: '+state.failed,'Status: '+state.message].join(String.fromCharCode(10))}
async function run(){stopped=false;productTab=window.open('about:blank','ptph-regular-collector');if(!productTab){statusBox.textContent='Chrome blocked the product tab. Allow pop-ups for 127.0.0.1 and click Start again.';return}startButton.disabled=true;stopButton.disabled=false;await call('/start',{method:'POST',body:'{}'});while(!stopped){let claim;try{claim=await call('/claim',{method:'POST',body:'{}'})}catch(error){if(error.status===429){render({...error.body.state,message:''+Math.max(1,Math.ceil(error.body.waitMs/1000))});await wait(Math.min(1000,Math.max(100,error.body.waitMs||1000)));continue}throw error}render(claim.state);if(!claim.product)break;if(productTab.closed){await call('/stop',{method:'POST',body:'{}'}).catch(()=>{});throw new Error('The dedicated Shopee tab was closed.')}productTab.location.href=claim.product.productUrl;const deadline=Date.now()+${productTimeoutMs};while(Date.now()<deadline&&!stopped){await wait(1000);const state=await call('/state');render(state);if(!state.currentProduct)break;if(productTab.closed){stopped=true;break}}const state=await call('/state');if(state.currentProduct&&!stopped)await call('/timeout',{method:'POST',body:'{}'}).catch(()=>{});if(state.mode==='paused'||state.mode==='finished')break}const finalState=await call('/state').catch(()=>null);if(finalState)render(finalState);startButton.disabled=false;stopButton.disabled=true}
startButton.addEventListener('click',()=>run().catch(error=>{statusBox.textContent='Stopped: '+error.message;startButton.disabled=false;stopButton.disabled=true}));stopButton.addEventListener('click',async()=>{stopped=true;await call('/stop',{method:'POST',body:'{}'}).catch(()=>{});render(await call('/state'));startButton.disabled=false;stopButton.disabled=true});
</script></body></html>`;
}

async function main() {
  await loadLocalEnvironment();
  const site = String(process.env.PRICETRACK_SITE || "https://pricetrackph.com").replace(/\/$/, "");
  const token = String(process.env.PRICETRACK_ADMIN_TOKEN || "").trim();
  if (!token || token === "paste_your_existing_admin_token_here") throw new Error("Open .env.local and add your PriceTrack PH admin token.");
  const limit = requestedLimit(); const delayMs = safeDelay();
  const state = { mode: "idle", message: "Ready", attempted: 0, succeeded: 0, failed: 0, consecutiveFailures: 0, currentProduct: null, nextAt: 0, limit: Number.isFinite(limit) ? limit : null, totalTracked: 0, totalDue: 0 };
  const attemptedProductIds = new Set();
  let lastSummaryCheckAt = 0;
  let summaryCheckPromise = null;

  async function releaseCurrent() {
    const product = state.currentProduct; state.currentProduct = null;
    if (product) await apiRequest(site, token, "release", { productId: product.productId }).catch(() => {});
  }

  function completionWasRecorded(currentDue) {
    return Number(currentDue) < state.totalDue - state.succeeded;
  }

  async function refreshExternalCompletion() {
    if (state.mode !== "running" || !state.currentProduct || Date.now() - lastSummaryCheckAt < 2000) return;
    lastSummaryCheckAt = Date.now();
    if (!summaryCheckPromise) {
      summaryCheckPromise = (async () => {
        const summary = await apiRequest(site, token, "summary", {});
        if (!state.currentProduct || !completionWasRecorded(summary.totalDue)) return;
        const product = state.currentProduct;
        state.currentProduct = null;
        state.succeeded += 1;
        state.consecutiveFailures = 0;
        state.nextAt = Date.now() + delayMs;
        state.message = `Recorded ${product.shopId}.${product.externalProductId}`;
        await apiRequest(site, token, "release", { productId: product.productId }).catch(() => {});
      })().finally(() => { summaryCheckPromise = null; });
    }
    await summaryCheckPromise.catch(() => {});
  }

  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    try {
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" }).end(controllerHtml(limit, delayMs)); return; }
      if (request.method === "GET" && url.pathname === "/state") { await refreshExternalCompletion(); return sendJson(response, 200, state); }
      if (request.method === "POST" && url.pathname === "/start") {
        await releaseCurrent();
        const summary = await apiRequest(site, token, "summary", {});
        attemptedProductIds.clear();
        Object.assign(state, { mode: "running", message: "Starting", attempted: 0, succeeded: 0, failed: 0, consecutiveFailures: 0, nextAt: 0, totalTracked: summary.totalTracked, totalDue: summary.totalDue }); return sendJson(response, 200, state);
      }
      if (request.method === "POST" && url.pathname === "/claim") {
        if (state.mode !== "running") return sendJson(response, 200, { product: null, state });
        if (state.currentProduct) return sendJson(response, 200, { product: state.currentProduct, state });
        if (Number.isFinite(limit) && state.attempted >= limit) { state.mode = "finished"; state.message = "Test finished"; return sendJson(response, 200, { product: null, state }); }
        if (state.nextAt > Date.now()) return sendJson(response, 429, { error: "Waiting between products", waitMs: state.nextAt - Date.now(), state });
        const claim = await apiRequest(site, token, "claim", { attemptedProductIds:[...attemptedProductIds] });
        if (!claim.product) { state.mode = "finished"; state.message = "No more due products"; return sendJson(response, 200, { product: null, state }); }
        attemptedProductIds.add(claim.product.productId);
        state.currentProduct = claim.product; state.attempted += 1; state.message = `Opening ${claim.product.shopId}.${claim.product.externalProductId}`; return sendJson(response, 200, { product: claim.product, state });
      }
      if (request.method === "POST" && url.pathname === "/observations") {
        const observation = await readJson(request); const product = state.currentProduct;
        if (!product || String(observation.shopId) !== product.shopId || String(observation.productId) !== product.externalProductId) return sendJson(response, 409, { error: "This tab is not the product currently assigned to the collector" });
        let result;
        try { result = await apiRequest(site, token, "record", { payload: observation }); }
        catch (error) { await releaseCurrent(); state.failed += 1; state.consecutiveFailures += 1; state.nextAt = Date.now() + delayMs; state.message = `Recording failed; continuing`; throw error; }
        state.succeeded += 1; state.consecutiveFailures = 0; state.currentProduct = null; state.nextAt = Date.now() + delayMs; state.message = `Recorded ${product.shopId}.${product.externalProductId}; waiting ${Math.round(delayMs / 1000)} seconds`; return sendJson(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/timeout") {
        await releaseCurrent(); state.failed += 1; state.consecutiveFailures += 1; state.nextAt = Date.now() + delayMs;
        if (state.consecutiveFailures >= 2) { state.mode = "paused"; state.message = "Paused after two consecutive timeouts. Check the Shopee tab for verification."; }
        else state.message = `Timed out; waiting ${Math.round(delayMs / 1000)} seconds before one more attempt`;
        return sendJson(response, 200, state);
      }
      if (request.method === "POST" && url.pathname === "/stop") { await releaseCurrent(); state.mode = "stopped"; state.message = "Stopped safely"; return sendJson(response, 200, state); }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) { console.error(error); return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), state }); }
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const controllerUrl = `http://${host}:${port}/`;
  console.log(`PriceTrack PH regular Chrome collector is ready: ${controllerUrl}`);
  console.log("Your normal browser will open. Click Start collection once.\n");
  if (process.platform === "win32") {
    const chromeExecutable = findWindowsChrome();
    if (!chromeExecutable) throw new Error(`Google Chrome was not found. Open ${controllerUrl} manually in Chrome.`);
    spawn(chromeExecutable, [controllerUrl], { detached: true, stdio: "ignore" }).unref();
  }
  else console.log(`Open ${controllerUrl} in your regular Chrome browser.`);
  const shutdown = async () => { await releaseCurrent(); server.close(() => process.exit(0)); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}

main().catch((error) => { console.error(`\nCollector stopped: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
