import { useEffect, useRef, useState } from "react";

type CollectorSummary = {
  totalTracked: number;
  totalDue: number;
  soldOutDeferred: number;
};

type CollectorProduct = {
  productId: number;
  shopId: string;
  externalProductId: string;
  productUrl: string;
};

type CollectorRun = {
  runId: string;
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number;
  succeeded: number;
  failed: number;
  remaining: number;
  stopStatus: "stopped" | "stopped_safely";
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export default function AdminCollector() {
  const token = sessionStorage.getItem("pricetrack-admin-health-token") || "";
  const [summary, setSummary] = useState<CollectorSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Opening collector…");
  const [currentProduct, setCurrentProduct] = useState<CollectorProduct | null>(null);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<CollectorRun[]>([]);
  const stopped = useRef(true);
  const productTab = useRef<Window | null>(null);
  const activeProduct = useRef<CollectorProduct | null>(null);
  const attemptedProductIds = useRef(new Set<number>());
  const startedAt = useRef<string | null>(null);
  const runId = useRef<string | null>(null);
  const succeededCount = useRef(0);
  const failedCount = useRef(0);

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

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    if (!token) {
      window.location.replace("/admin");
      return () => document.body.classList.remove("admin-page-active");
    }
    void Promise.all([
      api<CollectorSummary & { ok: boolean }>("summary"),
      api<{ ok: boolean; history: CollectorRun[] }>("history"),
    ])
      .then(([next, runs]) => { setSummary(next); setHistory(runs.history); setMessage("Ready"); })
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : "Unable to open collector."));
    return () => {
      stopped.current = true;
      document.body.classList.remove("admin-page-active");
    };
  }, []);

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
    if (product) await api("release", { productId: product.productId }).catch(() => undefined);
  }

  async function runCollection() {
    let consecutiveFailures = 0;
    while (!stopped.current) {
      const claim = await api<{ product: CollectorProduct | null }>("claim", {
        attemptedProductIds: [...attemptedProductIds.current],
      });
      const product = claim.product;
      if (!product) { setMessage("No more available due products"); break; }
      attemptedProductIds.current.add(product.productId);
      activeProduct.current = product;
      setCurrentProduct(product);
      setMessage(`Opening ${product.shopId}.${product.externalProductId}`);
      if (!productTab.current || productTab.current.closed) throw new Error("The dedicated Shopee tab was closed.");
      productTab.current.location.href = product.productUrl;

      let completed = false;
      const deadline = Date.now() + 75_000;
      while (!stopped.current && Date.now() < deadline) {
        await wait(1000);
        const status = await api<{ completed: boolean }>("status", { productId: product.productId });
        if (status.completed) { completed = true; break; }
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
      consecutiveFailures = 0;
      await wait(1_000);
    }
    stopped.current = true;
    setRunning(false);
  }

  async function startCollection() {
    const opened = window.open("about:blank", "ptph-admin-collector");
    if (!opened) { setMessage("Allow pop-ups for PriceTrack PH, then click Start collection again."); return; }
    productTab.current = opened;
    stopped.current = false;
    attemptedProductIds.current.clear();
    succeededCount.current = 0; failedCount.current = 0;
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
    if (!runId.current || !startedAt.current) return;
    const stoppedAt = new Date().toISOString();
    const run: CollectorRun = {
      runId: runId.current,
      startedAt: startedAt.current,
      stoppedAt,
      durationSeconds: Math.max(0, Math.round((Date.parse(stoppedAt) - Date.parse(startedAt.current)) / 1000)),
      succeeded: succeededCount.current,
      failed: failedCount.current,
      remaining,
      stopStatus: status,
    };
    runId.current = null;
    await api("finish", { run });
    setHistory((items) => [run, ...items.filter((item) => item.runId !== run.runId)].slice(0, 50));
  }

  const remaining = Math.max(0, (summary?.totalDue || 0) - succeeded - failed - (currentProduct ? 1 : 0));

  return <main className="health-page">
    <div className="health-shell">
      <div className="health-heading"><div><span className="health-kicker">PRIVATE ADMIN</span><h1>PriceTrack PH collector</h1><p>Randomly check available Shopee products in one dedicated Chrome tab.</p></div></div>
      <section className="admin-collector-panel">
        <div className="admin-collector-actions">
          <button type="button" onClick={() => void startCollection()} disabled={running || !summary}>Start collection</button>
          <button type="button" onClick={() => void stopCollection()} disabled={!running}>Stop collection</button>
        </div>
        <div className="admin-collector-status" aria-live="polite">
          <span>Total products: {summary?.totalTracked ?? "—"}</span>
          <span>Available and due: {summary?.totalDue ?? "—"}</span>
          <span>Sold out excluded: {summary?.soldOutDeferred ?? "—"}</span>
          <span>Currently processing: {currentProduct ? 1 : 0}</span>
          <span>Remaining in this run: {summary ? remaining : "—"}</span>
          <span>Succeeded this run: {succeeded}</span>
          <span>Failed this run: {failed}</span>
          <strong>Status: {message}</strong>
        </div>
        <p className="admin-collector-note">Keep this page and the dedicated Shopee tab open. Complete Shopee verification manually if it appears.</p>
      </section>
      <section className="health-events admin-collector-history">
        <h2>Collection history</h2>
        {history.length === 0 ? <p className="health-empty">No stopped collection runs yet.</p> : <div className="health-table-wrap"><table>
          <thead><tr><th>Time</th><th>Total running time</th><th>Succeeded</th><th>Failed</th><th>Products remaining</th><th>Status</th></tr></thead>
          <tbody>{history.map((run) => <tr key={run.runId}>
            <td>{new Date(run.startedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
            <td>{Math.floor(run.durationSeconds / 3600)}h {Math.floor((run.durationSeconds % 3600) / 60)}m {run.durationSeconds % 60}s</td>
            <td>{run.succeeded}</td><td>{run.failed}</td><td>{run.remaining}</td>
            <td>{run.stopStatus === "stopped_safely" ? "Stopped safely" : "Stopped"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>
  </main>;
}
