import { useEffect, useRef, useState } from "react";
import {
  cooldownEndAfterLimit,
  cooldownSecondsRemaining,
  reachedCollectionLimit,
} from "./collector-session-policy";
import {
  productUrlWithSkipUnchangedDay,
  skipUnchangedDayDefault,
} from "./admin-collector-settings";
import {
  includeStoreImportsDefault,
  normalizeShopeeStoreUrl,
  STORE_SCAN_EXTENSION_SOURCE,
  STORE_SCAN_PAGE_SOURCE,
} from "./store-import-contract";

type CollectorSummary = {
  totalTracked: number;
  totalDue: number;
  soldOutDeferred: number;
  samePriceDeferred: number;
  priorityPending: number;
  storeQueuePending: number;
};

type CollectorProduct = {
  claimSource: "priority" | "store" | "random";
  queueRequestId: string | null;
  productId: number | null;
  shopId: string;
  externalProductId: string;
  productUrl: string;
  leaseUntil: string;
};

type SavedStore = {
  id: string;
  storeKey: string;
  storeUrl: string;
  displayName: string;
  firstAddedAt: string;
  lastScanStartedAt: string | null;
  lastScanFinishedAt: string | null;
  lastScanStatus: "completed" | "incomplete" | "failed" | null;
  discovered: number;
  newlyQueued: number;
  duplicate: number;
  alreadyTracked: number;
};

type ScanTotals = { discovered: number; newlyQueued: number; duplicate: number; alreadyTracked: number };

type CollectorRun = {
  runId: string;
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number;
  succeeded: number;
  failed: number;
  soldOut: number;
  remaining: number;
  recheckAt: string | null;
  samePrice: number;
  samePriceRecheckAt: string | null;
  stopStatus: "stopped" | "stopped_safely";
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const cooldownStorageKey = "pricetrack-admin-collector-cooldown-until";
const skipUnchangedStorageKey = "pricetrack-admin-collector-skip-unchanged-day";
const includeStoreImportsStorageKey = "pricetrack-admin-collector-include-store-imports";

export default function AdminCollector() {
  const token = sessionStorage.getItem("pricetrack-admin-health-token") || "";
  const [summary, setSummary] = useState<CollectorSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Opening collector…");
  const [currentProduct, setCurrentProduct] = useState<CollectorProduct | null>(null);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<CollectorRun[]>([]);
  const [savedStores, setSavedStores] = useState<SavedStore[]>([]);
  const [storeUrl, setStoreUrl] = useState("");
  const [scanningStore, setScanningStore] = useState(false);
  const [storeMessage, setStoreMessage] = useState("Paste a Shopee store link to discover its visible products.");
  const [scanTotals, setScanTotals] = useState<ScanTotals>({ discovered: 0, newlyQueued: 0, duplicate: 0, alreadyTracked: 0 });
  const [skipUnchangedDay, setSkipUnchangedDay] = useState(() =>
    skipUnchangedDayDefault(localStorage.getItem(skipUnchangedStorageKey))
  );
  const [includeStoreImports, setIncludeStoreImports] = useState(() =>
    includeStoreImportsDefault(localStorage.getItem(includeStoreImportsStorageKey))
  );
  const [cooldownUntil, setCooldownUntil] = useState(() => Number(localStorage.getItem(cooldownStorageKey)) || 0);
  const [cooldownSeconds, setCooldownSeconds] = useState(() => cooldownSecondsRemaining(Number(localStorage.getItem(cooldownStorageKey)) || 0, Date.now()));
  const stopped = useRef(true);
  const productTab = useRef<Window | null>(null);
  const activeProduct = useRef<CollectorProduct | null>(null);
  const attemptedProductIds = useRef(new Set<number>());
  const attemptedQueueRequestIds = useRef(new Set<string>());
  const attemptedStoreRequestIds = useRef(new Set<string>());
  const activeScanId = useRef<string | null>(null);
  const scanChain = useRef<Promise<unknown>>(Promise.resolve());
  const scanTimeout = useRef<number | null>(null);
  const startedAt = useRef<string | null>(null);
  const runId = useRef<string | null>(null);
  const succeededCount = useRef(0);
  const failedCount = useRef(0);
  const soldOutCount = useRef(0);
  const recheckAt = useRef<string | null>(null);
  const samePriceCount = useRef(0);
  const samePriceRecheckAt = useRef<string | null>(null);

  async function api<T>(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch(`/api/admin-pc-collector?action=${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem("pricetrack-admin-health-token");
      window.location.replace("/admin");
      throw new Error("Admin login expired.");
    }
    if (!response.ok) throw new Error(payload.error || "Collector request failed.");
    return payload as T;
  }

  async function storeApi<T>(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch(`/api/admin-store-import?action=${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem("pricetrack-admin-health-token");
      window.location.replace("/admin");
      throw new Error("Admin login expired.");
    }
    if (!response.ok) throw new Error(payload.error || "Store import request failed.");
    return payload as T;
  }

  async function refreshStoresAndSummary() {
    const [next, stores] = await Promise.all([
      api<CollectorSummary & { ok: boolean }>("summary"),
      storeApi<{ ok: boolean; stores: SavedStore[] }>("list"),
    ]);
    setSummary(next);
    setSavedStores(stores.stores);
  }

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    if (!token) {
      window.location.replace("/admin");
      return () => document.body.classList.remove("admin-page-active");
    }
    void Promise.all([
      api<CollectorSummary & { ok: boolean }>("summary"),
      api<{ ok: boolean; history: CollectorRun[] }>("history"),
      storeApi<{ ok: boolean; stores: SavedStore[] }>("list"),
    ])
      .then(([next, runs, stores]) => { setSummary(next); setHistory(runs.history); setSavedStores(stores.stores); setMessage("Ready"); })
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : "Unable to open collector."));
    return () => {
      stopped.current = true;
      document.body.classList.remove("admin-page-active");
    };
  }, []);

  async function startStoreScan(value = storeUrl) {
    if (scanningStore || running) return;
    const store = normalizeShopeeStoreUrl(value);
    if (!store) { setStoreMessage("Enter a valid Shopee Philippines store link."); return; }
    const scanId = crypto.randomUUID();
    setScanningStore(true);
    setScanTotals({ discovered: 0, newlyQueued: 0, duplicate: 0, alreadyTracked: 0 });
    setStoreMessage("Opening the Shopee store scanner…");
    activeScanId.current = scanId;
    scanChain.current = Promise.resolve();
    try {
      await storeApi<{ storeId: string }>("begin", { storeUrl: store.storeUrl, scanId });
      window.postMessage({ source: STORE_SCAN_PAGE_SOURCE, type: "start", scanId, storeUrl: store.storeUrl }, window.location.origin);
      scanTimeout.current = window.setTimeout(() => {
        if (activeScanId.current !== scanId) return;
        scanChain.current = scanChain.current.then(async () => {
          await storeApi("finish", { scanId, status: "incomplete" });
          await refreshStoresAndSummary();
          activeScanId.current = null;
          setScanningStore(false);
          setStoreMessage("Scan incomplete. Update the extension or Recheck this store later.");
        });
      }, 4 * 60_000);
    } catch (cause) {
      activeScanId.current = null;
      setScanningStore(false);
      setStoreMessage(cause instanceof Error ? cause.message : "Unable to start the store scan.");
    }
  }

  useEffect(() => {
    const onStoreScanMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== STORE_SCAN_EXTENSION_SOURCE || data.scanId !== activeScanId.current) return;
      if (data.type === "ready") {
        setStoreMessage("Scanning visible products in the Shopee store tab…");
        return;
      }
      if (data.type === "progress" || data.type === "storeScanProgress") {
        scanChain.current = scanChain.current.then(async () => {
          const result = await storeApi<{ totals: ScanTotals }>("batch", { scanId: data.scanId, products: data.products });
          setScanTotals((current) => ({
            discovered: current.discovered + result.totals.discovered,
            newlyQueued: current.newlyQueued + result.totals.newlyQueued,
            duplicate: current.duplicate + result.totals.duplicate,
            alreadyTracked: current.alreadyTracked + result.totals.alreadyTracked,
          }));
        });
        return;
      }
      if (data.type === "error" || data.type === "finished" || data.type === "storeScanFinished") {
        scanChain.current = scanChain.current.then(async () => {
          const failed = data.type === "error";
          const status = failed ? "failed" : data.status === "completed" ? "completed" : "incomplete";
          await storeApi<{ result: ScanTotals }>(failed ? "fail" : "finish", { scanId: data.scanId, status });
          await refreshStoresAndSummary();
          setStoreMessage(failed ? (data.error || "Extension update required or the scan could not start.")
            : status === "completed" ? "Store scan completed. Click Start collection when ready."
              : "Scan incomplete. Imported products were saved and you can Recheck later.");
          setScanningStore(false);
          activeScanId.current = null;
          if (scanTimeout.current) window.clearTimeout(scanTimeout.current);
        }).catch((cause) => {
          setStoreMessage(cause instanceof Error ? cause.message : "Store scan stopped.");
          setScanningStore(false);
          activeScanId.current = null;
        });
      }
    };
    window.addEventListener("message", onStoreScanMessage);
    return () => window.removeEventListener("message", onStoreScanMessage);
  }, []);

  useEffect(() => {
    if (!cooldownUntil) return;
    const updateCountdown = () => {
      const seconds = cooldownSecondsRemaining(cooldownUntil, Date.now());
      setCooldownSeconds(seconds);
      if (seconds === 0) {
        localStorage.removeItem(cooldownStorageKey);
        setCooldownUntil(0);
        setMessage("Ready");
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
    if (links.length < 2) return;
    const [healthLink, affiliateLink] = links;
    const adsLink = document.createElement("a");
    const collectorLink = document.createElement("a");
    affiliateLink.after(adsLink, collectorLink);
    healthLink.textContent = "Health"; healthLink.href = "/admin/health"; healthLink.removeAttribute("data-scroll-target");
    affiliateLink.textContent = "Affiliate"; affiliateLink.href = "/admin/affiliate"; affiliateLink.removeAttribute("data-scroll-target");
    adsLink.textContent = "Ads"; adsLink.href = "/admin/ads";
    collectorLink.textContent = "Collector"; collectorLink.href = "/admin/collector"; collectorLink.setAttribute("aria-current", "page");
    return () => { adsLink.remove(); collectorLink.remove(); };
  }, []);

  async function releaseCurrent() {
    const product = activeProduct.current;
    activeProduct.current = null;
    setCurrentProduct(null);
    if (product) await api("release", {
      claimSource: product.claimSource,
      queueRequestId: product.queueRequestId,
      productId: product.productId,
      leaseUntil: product.leaseUntil,
    }).catch(() => undefined);
  }

  async function finishRun(status: CollectorRun["stopStatus"]) {
    if (!runId.current || !startedAt.current) return;
    const stoppedAt = new Date().toISOString();
    const run: CollectorRun = {
      runId: runId.current,
      startedAt: startedAt.current,
      stoppedAt,
      durationSeconds: Math.max(0, Math.round((Date.parse(stoppedAt) - Date.parse(startedAt.current)) / 1000)),
      succeeded: succeededCount.current,
      failed: failedCount.current,
      soldOut: soldOutCount.current,
      remaining: Math.max(0, (summary?.totalDue || 0) - succeededCount.current - failedCount.current),
      recheckAt: recheckAt.current,
      samePrice: samePriceCount.current,
      samePriceRecheckAt: samePriceRecheckAt.current,
      stopStatus: status,
    };
    runId.current = null;
    const { saved } = await api<{ saved: CollectorRun }>("finish", { run });
    setHistory((items) => [
      { ...run, remaining: saved.remaining },
      ...items.filter((item) => item.runId !== run.runId),
    ].slice(0, 50));
  }

  async function runCollection() {
    let consecutiveFailures = 0;
    while (!stopped.current) {
      const claim = await api<{ product: CollectorProduct | null }>("claim", {
        attemptedProductIds: [...attemptedProductIds.current],
        attemptedQueueRequestIds: [...attemptedQueueRequestIds.current],
        attemptedStoreRequestIds: [...attemptedStoreRequestIds.current],
        includeStoreImports: includeStoreImports,
      });
      const product = claim.product;
      if (!product) {
        setMessage("No more available due products");
        await finishRun("stopped_safely");
        break;
      }
      if (product.productId !== null) attemptedProductIds.current.add(product.productId);
      if (product.queueRequestId !== null && product.claimSource === "priority") attemptedQueueRequestIds.current.add(product.queueRequestId);
      if (product.queueRequestId !== null && product.claimSource === "store") attemptedStoreRequestIds.current.add(product.queueRequestId);
      activeProduct.current = product;
      setCurrentProduct(product);
      setMessage(`Opening ${product.shopId}.${product.externalProductId}`);
      if (!productTab.current || productTab.current.closed) throw new Error("The dedicated Shopee tab was closed.");
      productTab.current.location.href = productUrlWithSkipUnchangedDay(product.productUrl, skipUnchangedDay);

      let completed = false;
      const deadline = Date.now() + 75_000;
      while (!stopped.current && Date.now() < deadline) {
        await wait(1000);
        const status = await api<{ completed: boolean; soldOut: boolean; recheckAt: string | null; samePrice: boolean; samePriceRecheckAt: string | null }>("status",
          { ...(product.productId === null
            ? { shopId: product.shopId, externalProductId: product.externalProductId }
            : { productId: product.productId }), skipUnchangedDay: skipUnchangedDay },
        );
        if (status.completed) {
          if (status.soldOut) {
            soldOutCount.current += 1;
            recheckAt.current = status.recheckAt;
          }
          if (status.samePrice) {
            samePriceCount.current += 1;
            samePriceRecheckAt.current = status.samePriceRecheckAt;
          }
          completed = true;
          break;
        }
      }
      if (stopped.current) break;

      if (!completed) {
        await releaseCurrent();
        failedCount.current += 1;
        setFailed(failedCount.current);
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) { setMessage("Paused after two products did not finish recording"); break; }
        continue;
      }

      activeProduct.current = null;
      setCurrentProduct(null);
      succeededCount.current += 1;
      setSucceeded(succeededCount.current);
      if (product.claimSource !== "random") {
        const next = await api<CollectorSummary & { ok: boolean }>("summary");
        setSummary(next);
      }
      consecutiveFailures = 0;
      if (reachedCollectionLimit(succeededCount.current)) {
        stopped.current = true;
        setRunning(false);
        const nextCooldownUntil = cooldownEndAfterLimit(Date.now());
        localStorage.setItem(cooldownStorageKey, String(nextCooldownUntil));
        setCooldownUntil(nextCooldownUntil);
        setCooldownSeconds(cooldownSecondsRemaining(nextCooldownUntil, Date.now()));
        setMessage("50 products completed");
        await finishRun("stopped_safely");
        break;
      }
      await wait(1_000);
    }
    stopped.current = true;
    setRunning(false);
  }

  async function startCollection() {
    if (cooldownSeconds > 0) return;
    const opened = window.open("about:blank", "ptph-admin-collector");
    if (!opened) { setMessage("Allow pop-ups for PriceTrack PH, then click Start collection again."); return; }
    productTab.current = opened;
    stopped.current = false;
    attemptedProductIds.current.clear();
    attemptedQueueRequestIds.current.clear();
    attemptedStoreRequestIds.current.clear();
    succeededCount.current = 0; failedCount.current = 0;
    soldOutCount.current = 0; recheckAt.current = null;
    samePriceCount.current = 0; samePriceRecheckAt.current = null;
    startedAt.current = new Date().toISOString();
    runId.current = crypto.randomUUID();
    setSucceeded(0); setFailed(0); setRunning(true); setMessage("Starting");
    try {
      const next = await api<CollectorSummary & { ok: boolean }>("summary");
      setSummary(next);
      await runCollection();
    } catch (cause) {
      await releaseCurrent();
      stopped.current = true;
      setRunning(false);
      setMessage(cause instanceof Error ? cause.message : "Collector stopped.");
    }
  }

  async function stopCollection() {
    const wasProcessing = Boolean(activeProduct.current);
    stopped.current = true;
    await releaseCurrent();
    setRunning(false);
    const status: CollectorRun["stopStatus"] = wasProcessing ? "stopped" : "stopped_safely";
    setMessage(status === "stopped_safely" ? "Stopped safely" : "Stopped");
    await finishRun(status);
  }

  const remaining = Math.max(0, (summary?.totalDue || 0) - succeeded - failed - (currentProduct ? 1 : 0));

  return <main className="health-page">
    <div className="health-shell">
      <div className="health-heading"><div><span className="health-kicker">PRIVATE ADMIN</span><h1>PriceTrack PH collector</h1><p>Randomly check available Shopee products in one dedicated Chrome tab.</p></div></div>
      <section className="admin-collector-panel admin-store-import-panel">
        <h2>Import a Shopee store</h2>
        <p>Discover products visible in your browser, save the store, and collect full prices through the normal collector.</p>
        <form className="admin-store-import-form" onSubmit={(event) => { event.preventDefault(); void startStoreScan(); }}>
          <input type="url" value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder="Paste a Shopee store link" aria-label="Shopee store link" disabled={scanningStore || running} />
          <button type="submit" disabled={scanningStore || running}>{scanningStore ? "Scanning…" : "Scan store"}</button>
        </form>
        <div className="admin-store-scan-status" aria-live="polite">
          <strong>{storeMessage}</strong>
          <span>Found: {scanTotals.discovered}</span><span>Newly queued: {scanTotals.newlyQueued}</span>
          <span>Duplicate/queued: {scanTotals.duplicate}</span><span>Already tracked: {scanTotals.alreadyTracked}</span>
        </div>
        <h3>Saved stores</h3>
        {savedStores.length === 0 ? <p className="health-empty">No saved stores yet.</p> : <div className="health-table-wrap admin-saved-stores"><table>
          <thead><tr><th>Store</th><th>Last scan</th><th>Found</th><th>New</th><th>Status</th><th></th></tr></thead>
          <tbody>{savedStores.map((store) => <tr key={store.id}>
            <td><a href={store.storeUrl} target="_blank" rel="noreferrer">{store.displayName}</a></td>
            <td>{store.lastScanFinishedAt ? new Date(store.lastScanFinishedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
            <td>{store.discovered}</td><td>{store.newlyQueued}</td><td>{store.lastScanStatus || "—"}</td>
            <td><button type="button" onClick={() => void startStoreScan(store.storeUrl)} disabled={scanningStore || running}>Recheck</button></td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <section className="admin-collector-panel">
        <div className="admin-collector-actions">
          <button type="button" onClick={() => void startCollection()} disabled={running || cooldownSeconds > 0 || !summary}>Start collection</button>
          <button type="button" onClick={() => void stopCollection()} disabled={!running}>Stop collection</button>
        </div>
        <label className="admin-collector-option">
          <input
            type="checkbox"
            checked={skipUnchangedDay}
            disabled={running}
            onChange={(event) => {
              const nextValue = event.target.checked;
              setSkipUnchangedDay(nextValue);
              localStorage.setItem(skipUnchangedStorageKey, String(nextValue));
            }}
          />
          <span>Skip next day when price is unchanged</span>
        </label>
        <label className="admin-collector-option">
          <input type="checkbox" checked={includeStoreImports} disabled={running} onChange={(event) => {
            const nextValue = event.target.checked;
            setIncludeStoreImports(nextValue);
            localStorage.setItem(includeStoreImportsStorageKey, String(nextValue));
          }} />
          <span>Include store-imported products</span>
        </label>
        <div className="admin-collector-status" aria-live="polite">
          <span>Total products: {summary?.totalTracked ?? "—"}</span>
          <span>Available and due: {summary?.totalDue ?? "—"}</span>
          <span>Sold out excluded: {summary?.soldOutDeferred ?? "—"}</span>
          <span>Same price excluded: {summary?.samePriceDeferred ?? "—"}</span>
          <span>Priority queue pending: {summary?.priorityPending ?? "—"}</span>
          <span>Store queue pending: {summary?.storeQueuePending ?? "—"}</span>
          <span>Currently processing: {currentProduct ? 1 : 0}</span>
          <span>Remaining in this run: {summary ? remaining : "—"}</span>
          <span>Succeeded this run: {succeeded}</span>
          <span>Failed this run: {failed}</span>
          <strong>Status: {cooldownSeconds > 0
            ? `Next collection available in ${Math.floor(cooldownSeconds / 3600)}h ${Math.floor((cooldownSeconds % 3600) / 60)}m ${cooldownSeconds % 60}s`
            : message}</strong>
        </div>
        <p className="admin-collector-note">Keep this page and the dedicated Shopee tab open. Complete Shopee verification manually if it appears.</p>
      </section>
      <section className="health-events admin-collector-history">
        <h2>Collection history</h2>
        {history.length === 0 ? <p className="health-empty">No stopped collection runs yet.</p> : <div className="health-table-wrap"><table>
          <thead><tr><th>Time</th><th>Running time</th><th>Succeeded</th><th>Failed</th><th>Sold out</th><th>Same Price</th><th>Remaining</th><th>Status</th></tr></thead>
          <tbody>{history.map((run) => <tr key={run.runId}>
            <td>{new Date(run.startedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
            <td>{Math.floor(run.durationSeconds / 3600)}h {Math.floor((run.durationSeconds % 3600) / 60)}m {run.durationSeconds % 60}s</td>
            <td>{run.succeeded}</td><td>{run.failed}</td>
            <td>{run.soldOut}{run.recheckAt ? ` — ${new Date(run.recheckAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit" })}` : ""}</td>
            <td>{run.samePrice}{run.samePriceRecheckAt ? ` — ${new Date(run.samePriceRecheckAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit" })}` : ""}</td>
            <td>{run.remaining}</td>
            <td>{run.stopStatus === "stopped_safely" ? "Stopped safely" : "Stopped"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>
  </main>;
}
