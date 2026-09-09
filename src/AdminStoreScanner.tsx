import { useEffect, useRef, useState } from "react";
import {
  normalizeShopeeStoreUrl,
  STORE_SCAN_EXTENSION_SOURCE,
  STORE_SCAN_PAGE_SOURCE,
} from "./store-import-contract";
import { formatPageProgress, nextUnscannedStore, runningTimeLabel } from "./store-scan-ui";

type SavedStore = {
  id: string;
  storeUrl: string;
  displayName: string;
};

type ScanTotals = {
  discovered: number;
  newlyQueued: number;
  duplicate: number;
  alreadyTracked: number;
  soldOut: number;
  pagesCurrent: number;
  pagesTotal: number;
};

type StoreScan = ScanTotals & {
  scanId: string;
  storeId: string;
  storeUrl: string;
  displayName: string;
  startedAt: string;
  finishedAt: string | null;
  status: "completed" | "incomplete" | "interrupted";
};

const emptyTotals = (): ScanTotals => ({
  discovered: 0,
  newlyQueued: 0,
  duplicate: 0,
  alreadyTracked: 0,
  soldOut: 0,
  pagesCurrent: 0,
  pagesTotal: 0,
});

export default function AdminStoreScanner() {
  const token = sessionStorage.getItem("pricetrack-admin-health-token") || "";
  const [storeUrl, setStoreUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("Ready");
  const [totals, setTotals] = useState<ScanTotals>(emptyTotals);
  const [stores, setStores] = useState<SavedStore[]>([]);
  const [history, setHistory] = useState<StoreScan[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const activeScanId = useRef<string | null>(null);
  const scanActive = useRef(false);
  const readyTimer = useRef<number | null>(null);
  const historyRequest = useRef(0);
  const scanChain = useRef<Promise<unknown>>(Promise.resolve());
  const recheckQueue = useRef<SavedStore[]>([]);
  const recheckedIds = useRef(new Set<string>());

  async function storeApi<T>(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch(`/api/admin-pc-collector?action=store-${action}`, {
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
    if (!response.ok) throw new Error(payload.error || "Store scanner request failed.");
    return payload as T;
  }

  async function saveBatch(body: Record<string, unknown>) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await storeApi<{ totals: ScanTotals }>("batch", body);
      } catch (cause) {
        lastError = cause;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function refreshStores() {
    const response = await storeApi<{ stores: SavedStore[] }>("list");
    setStores(response.stores);
    return response.stores;
  }

  async function refreshHistory(nextPage = page, nextQuery = query, nextStatus = status) {
    const requestId = historyRequest.current + 1;
    historyRequest.current = requestId;
    const response = await storeApi<{ scans: StoreScan[]; total: number }>("history", {
      page: nextPage,
      query: nextQuery,
      status: nextStatus,
    });
    if (requestId !== historyRequest.current) return;
    setHistory(response.scans);
    setTotalRows(response.total);
  }

  async function startStoreScan(value = storeUrl) {
    if (scanActive.current) return;
    const store = normalizeShopeeStoreUrl(value);
    if (!store) {
      setMessage("Enter a valid Shopee Philippines store link.");
      return;
    }
    const scanId = crypto.randomUUID();
    setScanning(true);
    scanActive.current = true;
    setTotals(emptyTotals());
    setMessage("Opening the Shopee store scanner…");
    activeScanId.current = scanId;
    scanChain.current = Promise.resolve();
    try {
      await storeApi("begin", { storeUrl: store.storeUrl, scanId });
      window.postMessage({ source: STORE_SCAN_PAGE_SOURCE, type: "start", scanId, storeUrl: store.storeUrl }, window.location.origin);
      readyTimer.current = window.setTimeout(() => {
        if (activeScanId.current !== scanId) return;
        void storeApi("fail", { scanId, status: "interrupted", pagesCurrent: 0, pagesTotal: 0 })
          .then(() => refreshHistory(1, query, status))
          .catch(() => undefined);
        scanActive.current = false;
        activeScanId.current = null;
        setScanning(false);
        setMessage("Store scanner extension did not respond. Update or reload the extension, then recheck this store.");
      }, 15_000);
    } catch (cause) {
      activeScanId.current = null;
      scanActive.current = false;
      setScanning(false);
      setMessage(cause instanceof Error ? cause.message : "Unable to start the store scan.");
    }
  }

  async function continueRecheckAll() {
    const next = nextUnscannedStore(recheckQueue.current, recheckedIds.current);
    if (!next) {
      recheckQueue.current = [];
      recheckedIds.current.clear();
      setMessage("All saved stores were rechecked.");
      return;
    }
    recheckedIds.current.add(next.id);
    await startStoreScan(next.storeUrl);
  }

  async function recheckAllStores() {
    if (scanning) return;
    const currentStores = stores.length ? stores : await refreshStores();
    if (currentStores.length === 0) {
      setMessage("No saved stores to recheck.");
      return;
    }
    recheckQueue.current = currentStores;
    recheckedIds.current.clear();
    await continueRecheckAll();
  }

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    if (!token) {
      window.location.replace("/admin");
      return () => document.body.classList.remove("admin-page-active");
    }
    void Promise.all([refreshStores(), refreshHistory(1, "", "all")]).catch((cause) => {
      setMessage(cause instanceof Error ? cause.message : "Unable to open Store Scanner.");
    });
    return () => {
      if (readyTimer.current !== null) window.clearTimeout(readyTimer.current);
      document.body.classList.remove("admin-page-active");
    };
  }, []);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
    if (links.length < 2) return;
    const [healthLink, affiliateLink] = links;
    const adsLink = document.createElement("a");
    const collectorLink = document.createElement("a");
    const scannerLink = document.createElement("a");
    affiliateLink.after(adsLink, collectorLink, scannerLink);
    healthLink.textContent = "Health"; healthLink.href = "/admin/health"; healthLink.removeAttribute("data-scroll-target");
    affiliateLink.textContent = "Affiliate"; affiliateLink.href = "/admin/affiliate"; affiliateLink.removeAttribute("data-scroll-target");
    adsLink.textContent = "Ads"; adsLink.href = "/admin/ads";
    collectorLink.textContent = "Collector"; collectorLink.href = "/admin/collector";
    scannerLink.textContent = "Store Scanner"; scannerLink.href = "/admin/store-scanner"; scannerLink.setAttribute("aria-current", "page");
    return () => { adsLink.remove(); collectorLink.remove(); scannerLink.remove(); };
  }, []);

  useEffect(() => {
    const onStoreScanMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== STORE_SCAN_EXTENSION_SOURCE || data.scanId !== activeScanId.current) return;
      if (data.type === "ready") {
        if (readyTimer.current !== null) window.clearTimeout(readyTimer.current);
        readyTimer.current = null;
        setMessage("Scanning page 1…");
        return;
      }
      if (data.type === "progress" || data.type === "storeScanProgress") {
        setMessage(data.loadingSoldOut ? "Loading more sold-out products…" : `Scanning page ${data.pagesCurrent || 1}${data.pagesTotal ? ` of ${data.pagesTotal}` : ""}…`);
        scanChain.current = scanChain.current.then(async () => {
          const result = await saveBatch({
            scanId: data.scanId,
            products: data.products,
            pagesCurrent: data.pagesCurrent || 0,
            pagesTotal: data.pagesTotal || 0,
          });
          setTotals((current) => ({
            discovered: current.discovered + result.totals.discovered,
            newlyQueued: current.newlyQueued + result.totals.newlyQueued,
            duplicate: current.duplicate + result.totals.duplicate,
            alreadyTracked: current.alreadyTracked + result.totals.alreadyTracked,
            soldOut: current.soldOut + result.totals.soldOut,
            pagesCurrent: Math.max(current.pagesCurrent, result.totals.pagesCurrent),
            pagesTotal: Math.max(current.pagesTotal, result.totals.pagesTotal),
          }));
        });
        return;
      }
      if (data.type === "error" || data.type === "finished" || data.type === "storeScanFinished") {
        if (readyTimer.current !== null) window.clearTimeout(readyTimer.current);
        readyTimer.current = null;
        scanChain.current = scanChain.current.then(async () => {
          const interrupted = data.type === "error";
          const finalStatus = interrupted ? "interrupted" : data.status === "completed" ? "completed" : "incomplete";
          await storeApi(interrupted ? "fail" : "finish", {
            scanId: data.scanId,
            status: finalStatus,
            pagesCurrent: data.pagesCurrent || 0,
            pagesTotal: data.pagesTotal || 0,
          });
          window.postMessage({
            source: STORE_SCAN_PAGE_SOURCE,
            type: "completeAck",
            scanId: data.scanId,
            completed: finalStatus === "completed",
          }, window.location.origin);
          await Promise.all([refreshStores(), refreshHistory(1, query, status)]);
          setPage(1);
          setMessage(interrupted ? (data.error || "Store scan interrupted.")
            : finalStatus === "completed" ? "Scan completed"
              : "Scan incomplete. Discovered products were saved; recheck this store later.");
          setScanning(false);
          scanActive.current = false;
          activeScanId.current = null;
          if (recheckQueue.current.length) window.setTimeout(() => { void continueRecheckAll(); }, 0);
        }).catch(async (cause) => {
          await storeApi("fail", {
            scanId: data.scanId,
            status: "interrupted",
            pagesCurrent: data.pagesCurrent || 0,
            pagesTotal: data.pagesTotal || 0,
          }).catch(() => undefined);
          window.postMessage({ source: STORE_SCAN_PAGE_SOURCE, type: "completeAck", scanId: data.scanId, completed: false }, window.location.origin);
          await refreshHistory(1, query, status).catch(() => undefined);
          setMessage(cause instanceof Error ? cause.message : "Store scan interrupted.");
          setScanning(false);
          scanActive.current = false;
          activeScanId.current = null;
          recheckQueue.current = [];
          recheckedIds.current.clear();
        });
      }
    };
    window.addEventListener("message", onStoreScanMessage);
    return () => window.removeEventListener("message", onStoreScanMessage);
  }, [query, status]);

  const totalPages = Math.max(1, Math.ceil(totalRows / 20));

  return <main className="health-page admin-store-scanner">
    <div className="health-shell">
      <div className="health-heading"><div><span className="health-kicker">PRIVATE ADMIN</span><h1>Shopee Store Scanner</h1><p>Discover every regular and sold-out product from a Shopee store and add new products to PriceTrack PH.</p></div></div>
      <section className="admin-collector-panel admin-store-import-panel">
        <form className="admin-store-import-form" onSubmit={(event) => { event.preventDefault(); void startStoreScan(); }}>
          <input type="url" value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder="Paste a Shopee Philippines store link" aria-label="Shopee store link" disabled={scanning} />
          <button type="submit" disabled={scanning}>{scanning ? "Scanning…" : "Scan store"}</button>
          <button type="button" disabled={scanning || stores.length === 0} onClick={() => void recheckAllStores()}>Recheck all stores</button>
        </form>
        <div className="store-scan-summary" aria-live="polite">
          <span>Found<strong>{totals.discovered}</strong></span>
          <span>New queued<strong>{totals.newlyQueued}</strong></span>
          <span>Already queued<strong>{totals.duplicate}</strong></span>
          <span>Already tracked<strong>{totals.alreadyTracked}</strong></span>
          <span>Sold Out<strong>{totals.soldOut}</strong></span>
          <span>Pages scanned<strong>{formatPageProgress(totals.pagesCurrent, totals.pagesTotal)}</strong></span>
          <span>Current page<strong>{totals.pagesCurrent || "—"}</strong></span>
        </div>
        <p className="store-scan-message"><strong>{message}</strong></p>
      </section>

      <section className="health-events store-scan-history">
        <h2>Store Scan History</h2>
        <div className="store-scan-filters">
          <input value={query} placeholder="Search store" aria-label="Search store" onChange={(event) => { const value = event.target.value; setQuery(value); setPage(1); void refreshHistory(1, value, status); }} />
          <select value={status} aria-label="Filter scan status" onChange={(event) => { const value = event.target.value; setStatus(value); setPage(1); void refreshHistory(1, query, value); }}>
            <option value="all">All</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option><option value="interrupted">Interrupted</option>
          </select>
        </div>
        {history.length === 0 ? <p className="health-empty">No store scans found.</p> : <div className="health-table-wrap"><table>
          <thead><tr><th>Scan time</th><th>Store</th><th>Running time</th><th>Found</th><th>New queued</th><th>Already queued</th><th>Sold Out</th><th>Pages</th><th>Tracked</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{history.map((scan) => <tr key={scan.scanId}>
            <td>{new Date(scan.startedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
            <td><a className="store-scan-store-link" href={scan.storeUrl} target="_blank" rel="noreferrer">{scan.displayName}</a></td>
            <td>{runningTimeLabel(scan.startedAt, scan.finishedAt)}</td>
            <td>{scan.discovered}</td><td>{scan.newlyQueued}</td><td>{scan.duplicate}</td><td>{scan.soldOut}</td>
            <td>{formatPageProgress(scan.pagesCurrent, scan.pagesTotal)}</td><td>{scan.alreadyTracked}</td>
            <td>{scan.status === "completed" ? "Completed" : scan.status === "incomplete" ? "Incomplete" : "Interrupted"}</td>
            <td><button type="button" disabled={scanning} onClick={() => void startStoreScan(scan.storeUrl)}>Recheck</button></td>
          </tr>)}</tbody>
        </table></div>}
        <div className="store-scan-pagination">
          <button type="button" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); void refreshHistory(next); }}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => { const next = page + 1; setPage(next); void refreshHistory(next); }}>Next</button>
        </div>
      </section>
    </div>
  </main>;
}
