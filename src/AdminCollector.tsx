import { useEffect, useRef, useState } from "react";
import {
  cooldownEndAfterLimit,
  cooldownSecondsRemaining,
  reachedCollectionLimit,
} from "./collector-session-policy";
import {
  productUrlWithCollectorOptions,
  skipSoldOutDefault,
  skipUnchangedDayDefault,
} from "./admin-collector-settings";
import {
  clearCollectorRunCheckpoint,
  readCollectorRunCheckpoint,
  saveCollectorRunCheckpoint,
  type CollectorRunCheckpoint,
  type CollectorStopStatus,
} from "./collector-run-recovery";
import { includeStoreImportsDefault } from "./store-import-contract";
import { nextNonPrioritySource } from "./collector-queue-policy";
import { withCollectorRetry } from "./collector-request-policy";
import {
  collectorProductWaitExpired,
  collectorStopGraceExpired,
} from "./collector-product-wait-policy";
import { subscribeToAdminHistory } from "./admin-realtime";

type CollectorSummary = {
  totalTracked: number;
  totalDue: number;
  soldOutDeferred: number;
  samePriceDeferred: number;
  doesNotExistCount: number;
  unlistedCount: number;
  pageErrorCount: number;
  priorityPending: number;
  storeQueuePending: number;
};

type CollectorProduct = {
  claimSource: "priority" | "store" | "random" | "personal";
  queueRequestId: string | null;
  productId: number | null;
  shopId: string;
  externalProductId: string;
  productUrl: string;
  leaseUntil: string;
};

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
  stopStatus: CollectorStopStatus;
};
type CollectionMode = "normal" | "unlimited";
type ProductPageOutcome = "sold_out" | "does_not_exist" | "unlisted" | "page_error" | "verification";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const cooldownStorageKey = "pricetrack-admin-collector-cooldown-until";
const skipUnchangedStorageKey = "pricetrack-admin-collector-skip-unchanged-day";
const skipSoldOutStorageKey = "pricetrack-admin-collector-skip-sold-out";
const includeStoreImportsStorageKey = "pricetrack-admin-collector-include-store-imports";
const includeNormalQueueStorageKey = "pricetrack-admin-collector-include-normal-queue";
const includePriorityQueueStorageKey = "pricetrack-admin-collector-include-priority-queue";
const includePersonalQueueStorageKey = "pricetrack-admin-collector-include-personal-queue";
const favoriteQueueEventKey = "pricetrack-favorite-queue-updated";
const manilaDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

const formatCollectorCount = (value: number | string) =>
  typeof value === "number" ? value.toLocaleString("en-US") : value;

const collectorStatusCardStyle = {
  border: "1px solid",
  borderRadius: "8px",
  padding: "12px 14px",
  minHeight: "72px",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center" as const,
  gap: "6px",
};

function stopStatusLabel(status: CollectorStopStatus) {
  if (status === "stopped_safely") return "Stopped safely";
  if (status === "interrupted") return "Interrupted";
  if (status === "login_expired") return "Stopped — Login expired";
  if (status === "api_failure") return "Stopped — API failure";
  if (status === "confirmation_timeout") return "Stopped";
  return "Stopped";
}

function playVerificationSound() {
  try {
    const AudioContextClass = window.AudioContext;
    const audio = new AudioContextClass();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.18, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + 0.7);
    oscillator.addEventListener("ended", () => void audio.close(), { once: true });
  } catch {
    // The visible pause message remains available if browser audio is blocked.
  }
}

export default function AdminCollector() {
  const token = sessionStorage.getItem("pricetrack-admin-health-token") || "";
  const [summary, setSummary] = useState<CollectorSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Opening collector…");
  const [currentProduct, setCurrentProduct] = useState<CollectorProduct | null>(null);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const pendingFavorites = useRef(new Set<string>());
  const lastFavoriteClick = useRef<{ identity: string; at: number } | null>(null);
  const [favoriteNotice, setFavoriteNotice] = useState("");
  const favoriteNoticeTimer = useRef<number | null>(null);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<CollectorRun[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRefreshInFlight = useRef(false);
  const localHistoryVersion = useRef(0);
  const [remoteNotice, setRemoteNotice] = useState("");
  const [skipUnchangedDay, setSkipUnchangedDay] = useState(() =>
    skipUnchangedDayDefault(localStorage.getItem(skipUnchangedStorageKey))
  );
  const [skipSoldOut, setSkipSoldOut] = useState(() => skipSoldOutDefault(localStorage.getItem(skipSoldOutStorageKey)));
  const [includeStoreImports, setIncludeStoreImports] = useState(() =>
    includeStoreImportsDefault(localStorage.getItem(includeStoreImportsStorageKey))
  );
  const [includeNormalQueue, setIncludeNormalQueue] = useState(() => localStorage.getItem(includeNormalQueueStorageKey) !== "false");
  const [includePriorityQueue, setIncludePriorityQueue] = useState(() => localStorage.getItem(includePriorityQueueStorageKey) !== "false");
  const [includePersonalQueue, setIncludePersonalQueue] = useState(() => localStorage.getItem(includePersonalQueueStorageKey) === "true");
  const [cooldownUntil, setCooldownUntil] = useState(() => Number(localStorage.getItem(cooldownStorageKey)) || 0);
  const [cooldownSeconds, setCooldownSeconds] = useState(() => cooldownSecondsRemaining(Number(localStorage.getItem(cooldownStorageKey)) || 0, Date.now()));
  const stopped = useRef(true);
  const stopRequested = useRef(false);
  const stopRequestedAt = useRef<number | null>(null);
  const productTab = useRef<Window | null>(null);
  const activeProduct = useRef<CollectorProduct | null>(null);
  const attemptedProductIds = useRef(new Set<number>());
  const attemptedQueueRequestIds = useRef(new Set<string>());
  const attemptedStoreRequestIds = useRef(new Set<string>());
  const lastClaimedShopId = useRef<string | null>(null);
  const startedAt = useRef<string | null>(null);
  const runId = useRef<string | null>(null);
  const succeededCount = useRef(0);
  const failedCount = useRef(0);
  const soldOutCount = useRef(0);
  const recheckAt = useRef<string | null>(null);
  const samePriceCount = useRef(0);
  const samePriceRecheckAt = useRef<string | null>(null);
  const collectionMode = useRef<CollectionMode>("normal");
  const nonPriorityCadence = useRef(0);
  const currentPageOutcome = useRef<ProductPageOutcome | null>(null);
  const verificationAlertedFor = useRef(new Set<string>());
  const collectorSessionId = useRef(crypto.randomUUID());
  const publishHistory = useRef<(event: { kind: "collector" | "store" | "collector-progress"; status: string; id: string }) => unknown>(() => undefined);
  const remoteNoticeTimer = useRef<number | null>(null);
  const runManilaDate = useRef(manilaDate());
  const pageErrorRetries = useRef<CollectorProduct[]>([]);

  function resetDailyRunCounters() {
    succeededCount.current = 0; failedCount.current = 0; soldOutCount.current = 0; samePriceCount.current = 0;
    recheckAt.current = null; samePriceRecheckAt.current = null;
    setSucceeded(0); setFailed(0);
  }

  function checkpointRun(
    phase: "running" | "pending_finalization" = "running",
    intendedStopStatus?: CollectorStopStatus,
    failureReason?: CollectorRunCheckpoint["failureReason"],
  ) {
    if (!runId.current || !startedAt.current) return;
    saveCollectorRunCheckpoint(localStorage, {
      runId: runId.current, startedAt: startedAt.current,
      succeeded: succeededCount.current, failed: failedCount.current,
      soldOut: soldOutCount.current, recheckAt: recheckAt.current,
      samePrice: samePriceCount.current, samePriceRecheckAt: samePriceRecheckAt.current,
      remaining: Math.max(0, (summary?.totalDue || 0) - succeededCount.current - failedCount.current),
      phase,
      intendedStopStatus,
      failureReason,
      activeProduct: activeProduct.current,
    });
  }

  async function api<T>(action: string, body: Record<string, unknown> = {}) {
    return withCollectorRetry(async () => {
      const response = await fetch(`/api/admin-pc-collector?action=${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        checkpointRun("pending_finalization", "login_expired", "login_expired");
        sessionStorage.removeItem("pricetrack-admin-health-token");
        window.location.replace("/admin");
        throw Object.assign(new Error("Admin login expired."), { retryable: false, code: "AUTH_EXPIRED" });
      }
      if (!response.ok) throw Object.assign(new Error(payload.error || "Collector request failed."), {
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
      return payload as T;
    });
  }

  async function recoverCollectorCheckpoint(checkpoint: CollectorRunCheckpoint) {
    const recovered = { ...checkpoint };
    if (checkpoint.activeProduct) {
      let status: {
        completed: boolean; soldOut: boolean; recheckAt: string | null;
        samePrice: boolean; samePriceRecheckAt: string | null;
      } | null = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const identity = checkpoint.activeProduct.productId === null
          ? { shopId: checkpoint.activeProduct.shopId, externalProductId: checkpoint.activeProduct.externalProductId }
          : { productId: checkpoint.activeProduct.productId };
        status = await api<{
          completed: boolean; soldOut: boolean; recheckAt: string | null;
          samePrice: boolean; samePriceRecheckAt: string | null;
        }>("status", { ...identity, claimSource: checkpoint.activeProduct.claimSource, checkedDate: manilaDate(new Date(checkpoint.startedAt)) });
        if (status.completed) break;
        await wait(1_000);
      }
      if (status?.completed) {
        recovered.succeeded += 1;
        if (status.soldOut) {
          recovered.soldOut += 1;
          recovered.recheckAt = status.recheckAt;
        }
        if (status.samePrice) {
          recovered.samePrice += 1;
          recovered.samePriceRecheckAt = status.samePriceRecheckAt;
        }
      } else {
        recovered.failed += 1;
      }
      await api("release", {
        claimSource: checkpoint.activeProduct.claimSource,
        queueRequestId: checkpoint.activeProduct.queueRequestId,
        productId: checkpoint.activeProduct.productId,
        leaseUntil: checkpoint.activeProduct.leaseUntil,
      }).catch(() => undefined);
      recovered.activeProduct = null;
    }
    const stoppedAt = new Date().toISOString();
    const stopStatus: CollectorStopStatus = checkpoint.failureReason
      || (checkpoint.phase === "pending_finalization" ? checkpoint.intendedStopStatus || "stopped" : "interrupted");
    const { saved } = await api<{ saved: CollectorRun }>("finish", { run: {
      ...recovered,
      stoppedAt,
      durationSeconds: Math.max(0, Math.round((Date.parse(stoppedAt) - Date.parse(checkpoint.startedAt)) / 1000)),
      stopStatus,
    }, originSessionId: collectorSessionId.current });
    clearCollectorRunCheckpoint(localStorage);
    localHistoryVersion.current += 1;
    setHistory((items) => [saved, ...items.filter((item) => item.runId !== saved.runId)].slice(0, 20));
    void publishHistory.current({ kind: "collector", status: stopStatus, id: saved.runId });
  }

  useEffect(() => {
    if (!token) return;
    const refreshFavorites = () => void api<{ favorites: Array<{ products: { external_shop_id: string; external_product_id: string } | null }> }>("personal-list")
      .then(({ favorites }) => {
        setFavoriteIds(new Set(favorites.flatMap(({ products }) =>
          products ? [`${products.external_shop_id}.${products.external_product_id}`] : [],
        )));
      })
      .catch((cause) => showFavoriteNotice(cause instanceof Error ? cause.message : "Unable to load Favorite Queue."))
      .finally(() => setFavoritesLoaded(true));
    const onFavoriteChange = (event: StorageEvent) => { if (event.key === favoriteQueueEventKey) refreshFavorites(); };
    window.addEventListener("storage", onFavoriteChange);
    refreshFavorites();
    return () => window.removeEventListener("storage", onFavoriteChange);
  }, [token]);

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    if (!token) {
      window.location.replace("/admin");
      return () => document.body.classList.remove("admin-page-active");
    }
    const interrupted = readCollectorRunCheckpoint(localStorage);
    const recover = interrupted ? recoverCollectorCheckpoint(interrupted) : Promise.resolve();
    void recover.then(() => api<CollectorSummary & { ok: boolean; history: CollectorRun[]; hasMore: boolean }>("bootstrap"))
      .then((next) => { setSummary(next); setHistory(next.history); setHistoryHasMore(next.hasMore); setMessage("Ready"); })
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : "Unable to open collector."));
    return () => {
      stopped.current = true;
      document.body.classList.remove("admin-page-active");
    };
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
    // Refresh saved run history when a broadcast is missed while this tab sleeps.
    const refreshHistory = (force = false) => {
      if ((!force && document.visibilityState === "hidden") || historyRefreshInFlight.current) return;
      historyRefreshInFlight.current = true;
      const versionAtRequest = localHistoryVersion.current;
      void api<{ ok: boolean; history: CollectorRun[]; hasMore: boolean }>("history")
        .then((result) => {
          if (localHistoryVersion.current !== versionAtRequest) return;
          setHistory(result.history);
          setHistoryHasMore(result.hasMore);
        })
        .catch(() => undefined)
        .finally(() => { historyRefreshInFlight.current = false; });
    };
    const realtime = subscribeToAdminHistory((event) => {
      if (event.kind === "collector-progress") {
        void api<CollectorSummary & { ok: boolean }>("summary").then(setSummary);
        return;
      }
      if (event.kind !== "collector") return;
      refreshHistory(true);
      if (event.originSessionId === collectorSessionId.current) return;
      setRemoteNotice(`Another Collector run ${event.status.replace(/_/g, " ")}`);
      if (remoteNoticeTimer.current !== null) window.clearTimeout(remoteNoticeTimer.current);
      remoteNoticeTimer.current = window.setTimeout(() => setRemoteNotice(""), 5_000);
    });
    publishHistory.current = realtime.publish;
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refreshHistory(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const historyTimer = window.setInterval(() => refreshHistory(), 10_000);
    return () => {
      window.clearInterval(historyTimer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      realtime.unsubscribe();
      if (remoteNoticeTimer.current !== null) window.clearTimeout(remoteNoticeTimer.current);
    };
  }, []);

  async function refreshSharedSummary(product: CollectorProduct) {
    const next = await api<CollectorSummary & { ok: boolean }>("summary");
    setSummary(next);
    void publishHistory.current({
      kind: "collector-progress",
      status: "updated",
      id: `${product.shopId}.${product.externalProductId}`,
    });
  }

  async function loadMoreHistory() {
    if (!historyHasMore || historyLoading) return;
    setHistoryLoading(true);
    try {
      const result = await api<{ history: CollectorRun[]; hasMore: boolean }>("history", { offset: history.length });
      setHistory((items) => [...items, ...result.history]);
      setHistoryHasMore(result.hasMore);
    } finally { setHistoryLoading(false); }
  }

  useEffect(() => {
    const onProductOutcome = (event: MessageEvent) => {
      if (event.origin !== "https://shopee.ph" || event.source !== productTab.current) return;
      const data = event.data;
      if (data?.source !== "pricetrack-ph-collector-product" || data?.type !== "product-outcome") return;
      const product = activeProduct.current;
      if (!product || data.shopId !== product.shopId || data.externalProductId !== product.externalProductId) return;
      if (!["does_not_exist", "unlisted", "page_error", "verification"].includes(data.outcome)) return;
      currentPageOutcome.current = data.outcome;
      if (data.outcome === "verification") {
        const key = `${product.shopId}.${product.externalProductId}`;
        if (!verificationAlertedFor.current.has(key)) {
          verificationAlertedFor.current.add(key);
          playVerificationSound();
        }
        setMessage("Shopee verification required — collection paused until you complete it in the collector tab");
      }
    };
    window.addEventListener("message", onProductOutcome);
    return () => window.removeEventListener("message", onProductOutcome);
  }, []);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
    if (links.length < 2) return;
    const [healthLink, affiliateLink] = links;
    const settingsLink = document.createElement("a");
    const collectorLink = document.createElement("a");
    const scannerLink = document.createElement("a");
    affiliateLink.after(collectorLink, scannerLink, settingsLink);
    healthLink.textContent = "Health"; healthLink.href = "/admin/health"; healthLink.removeAttribute("data-scroll-target");
    affiliateLink.textContent = "Affiliate"; affiliateLink.href = "/admin/affiliate"; affiliateLink.removeAttribute("data-scroll-target");
    settingsLink.textContent = "Settings"; settingsLink.href = "/admin/settings";
    collectorLink.textContent = "Collector"; collectorLink.href = "/admin/collector"; collectorLink.setAttribute("aria-current", "page");
    scannerLink.textContent = "Store Scanner"; scannerLink.href = "/admin/store-scanner";
    return () => { settingsLink.remove(); collectorLink.remove(); scannerLink.remove(); };
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
    const failureReason = ["login_expired", "api_failure", "confirmation_timeout"].includes(status)
      ? status as CollectorRunCheckpoint["failureReason"]
      : undefined;
    checkpointRun("pending_finalization", status, failureReason);
    const { saved } = await api<{ saved: CollectorRun }>("finish", { run, originSessionId: collectorSessionId.current });
    runId.current = null;
    clearCollectorRunCheckpoint(localStorage);
    localHistoryVersion.current += 1;
    setHistory((items) => [
      { ...run, remaining: saved.remaining },
      ...items.filter((item) => item.runId !== run.runId),
    ].slice(0, 20));
  }

  async function runCollection() {
    let consecutiveFailures = 0;
    while (!stopped.current && !stopRequested.current) {
      const today = manilaDate();
      if (today !== runManilaDate.current) {
        runManilaDate.current = today;
        resetDailyRunCounters();
        setSummary(await api<CollectorSummary & { ok: boolean }>("summary"));
      }
      let claim = await api<{ product: CollectorProduct | null }>("claim", {
        attemptedProductIds: [...attemptedProductIds.current],
        attemptedQueueRequestIds: [...attemptedQueueRequestIds.current],
        attemptedStoreRequestIds: [...attemptedStoreRequestIds.current],
        lastShopId: lastClaimedShopId.current,
        includeStoreImports: includeStoreImports,
        includeNormalQueue,
        includePriorityQueue,
        includePersonalQueue,
        skipSoldOut,
        preferredSource: nextNonPrioritySource(nonPriorityCadence.current),
      });
      if (!claim.product && pageErrorRetries.current.length) {
        const retryProduct = pageErrorRetries.current.shift();
        if (retryProduct) claim = await api<{ product: CollectorProduct | null }>("reclaim", { product: retryProduct });
      }
      const product = claim.product;
      if (!product) {
        setMessage("No more available due products");
        await finishRun("stopped_safely");
        break;
      }
      lastClaimedShopId.current = product.shopId;
      if (product.productId !== null) attemptedProductIds.current.add(product.productId);
      if (product.queueRequestId !== null && product.claimSource === "priority") attemptedQueueRequestIds.current.add(product.queueRequestId);
      if (product.queueRequestId !== null && product.claimSource === "store") attemptedStoreRequestIds.current.add(product.queueRequestId);
      activeProduct.current = product;
      currentPageOutcome.current = null;
      setCurrentProduct(product);
      setMessage(`Opening ${product.shopId}.${product.externalProductId}`);
      if (!productTab.current || productTab.current.closed) throw new Error("The dedicated Shopee tab was closed.");
      productTab.current.location.href = productUrlWithCollectorOptions(product.productUrl, skipUnchangedDay, skipSoldOut);

      let completed = false;
      let confirmationTimedOut = false;
      const productWaitStartedAt = Date.now();
      while (!stopped.current) {
        await wait(1000);
        const pageOutcome = currentPageOutcome.current;
        if (pageOutcome && pageOutcome !== "verification") {
          const outcomeResult = await api<{ result?: { retryAfterCurrentRun?: boolean; recheckAt?: string | null } }>("outcome", {
            claimSource: product.claimSource,
            queueRequestId: product.queueRequestId,
            productId: product.productId,
            shopId: product.shopId,
            externalProductId: product.externalProductId,
            outcome: pageOutcome,
          });
          if (pageOutcome === "page_error" && outcomeResult.result?.retryAfterCurrentRun) {
            pageErrorRetries.current.push(product);
          }
          activeProduct.current = null;
          setCurrentProduct(null);
          if (pageOutcome === "sold_out") {
            soldOutCount.current += 1;
            recheckAt.current = outcomeResult.result?.recheckAt || null;
          } else {
            failedCount.current += 1;
            setFailed(failedCount.current);
          }
          await refreshSharedSummary(product);
          checkpointRun();
          setMessage(`${String(pageOutcome).replace(/_/g, " ")} skipped`);
          break;
        }
        const status = await api<{ completed: boolean; soldOut: boolean; recheckAt: string | null; samePrice: boolean; samePriceRecheckAt: string | null }>("status",
          { claimSource: product.claimSource, ...(product.productId === null
            ? { shopId: product.shopId, externalProductId: product.externalProductId }
            : { productId: product.productId }), skipUnchangedDay: skipUnchangedDay, skipSoldOut: skipSoldOut },
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
          checkpointRun();
          break;
        }
        if (
          collectorProductWaitExpired(productWaitStartedAt, Date.now())
          || collectorStopGraceExpired(stopRequestedAt.current, Date.now())
        ) {
          await releaseCurrent();
          failedCount.current += 1;
          setFailed(failedCount.current);
          checkpointRun();
          confirmationTimedOut = true;
          setMessage(stopRequested.current
            ? "Current product confirmation timed out; stopping safely"
            : "Current product confirmation timed out; moving to the next product");
          break;
        }
      }
      if (stopped.current) break;

      if (currentPageOutcome.current && currentPageOutcome.current !== "verification") {
        currentPageOutcome.current = null;
        consecutiveFailures = 0;
        if (stopRequested.current) {
          stopped.current = true;
          setRunning(false);
          setMessage("Stopped safely");
          await finishRun("stopped_safely");
          break;
        }
        continue;
      }

      if (confirmationTimedOut) {
        consecutiveFailures += 1;
        if (stopRequested.current) {
          stopped.current = true;
          setRunning(false);
          await finishRun("confirmation_timeout");
          break;
        }
        continue;
      }

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
      if (product.claimSource !== "priority") nonPriorityCadence.current += 1;
      setSucceeded(succeededCount.current);
      await refreshSharedSummary(product);
      consecutiveFailures = 0;
      checkpointRun();
      if (stopRequested.current) {
        stopped.current = true;
        setRunning(false);
        setMessage("Stopped safely");
        await finishRun("stopped_safely");
        break;
      }
      if (collectionMode.current === "normal" && reachedCollectionLimit(succeededCount.current)) {
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
      if (collectionMode.current === "normal") await wait(1_000);
    }
    stopped.current = true;
    setRunning(false);
  }

  async function startCollection(mode: CollectionMode = "normal") {
    if (mode === "normal" && cooldownSeconds > 0) return;
    const opened = window.open("about:blank", "ptph-admin-collector");
    if (!opened) { setMessage("Allow pop-ups for PriceTrack PH, then click Start collection again."); return; }
    productTab.current = opened;
    stopped.current = false;
    stopRequested.current = false;
    stopRequestedAt.current = null;
    attemptedProductIds.current.clear();
    attemptedQueueRequestIds.current.clear();
    attemptedStoreRequestIds.current.clear();
    lastClaimedShopId.current = null;
    verificationAlertedFor.current.clear();
    pageErrorRetries.current = [];
    succeededCount.current = 0; failedCount.current = 0;
    soldOutCount.current = 0; recheckAt.current = null;
    samePriceCount.current = 0; samePriceRecheckAt.current = null;
    startedAt.current = new Date().toISOString();
    runId.current = crypto.randomUUID();
    collectionMode.current = mode;
    nonPriorityCadence.current = 0;
    runManilaDate.current = manilaDate();
    checkpointRun();
    setSucceeded(0); setFailed(0); setRunning(true); setMessage("Starting");
    try {
      const next = await api<CollectorSummary & { ok: boolean }>("summary");
      setSummary(next);
      await runCollection();
    } catch (cause) {
      if (cause instanceof Error && (cause as Error & { code?: string }).code === "AUTH_EXPIRED") {
        stopped.current = true;
        setRunning(false);
        return;
      }
      stopped.current = true;
      setRunning(false);
      const errorMessage = cause instanceof Error ? cause.message : "Collector stopped.";
      checkpointRun("pending_finalization", "api_failure", "api_failure");
      const pendingRecovery = readCollectorRunCheckpoint(localStorage);
      try {
        if (pendingRecovery) {
          await recoverCollectorCheckpoint(pendingRecovery);
          runId.current = null;
          activeProduct.current = null;
          setCurrentProduct(null);
        } else {
          await finishRun("api_failure");
        }
        setMessage(errorMessage);
      } catch {
        setMessage(`${errorMessage} Run finalization will retry when this page opens again.`);
      }
    }
  }

  async function stopCollection() {
    if (activeProduct.current) {
      stopRequested.current = true;
      stopRequestedAt.current = Date.now();
      setMessage("Stopping after the current product finishes");
      return;
    }
    stopped.current = true;
    setRunning(false);
    setMessage("Stopped safely");
    await finishRun("stopped_safely");
  }

  function showFavoriteNotice(notice: string) {
    if (favoriteNoticeTimer.current !== null) window.clearTimeout(favoriteNoticeTimer.current);
    setFavoriteNotice(notice);
    favoriteNoticeTimer.current = window.setTimeout(() => setFavoriteNotice(""), 4000);
  }

  function publishFavoriteChange() {
    localStorage.setItem(favoriteQueueEventKey, `${Date.now()}:${crypto.randomUUID()}`);
  }

  function markFavorite(identity: string, saved: boolean) {
    setFavoriteIds((previous) => {
      const next = new Set(previous);
      if (saved) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }

  async function saveCurrentFavorite() {
    const product = activeProduct.current;
    if (!product || favoriteSaving || !favoritesLoaded) return;
    const identity = `${product.shopId}.${product.externalProductId}`;
    const clickedAt = Date.now();
    if (lastFavoriteClick.current?.identity === identity && clickedAt - lastFavoriteClick.current.at < 1500) return;
    lastFavoriteClick.current = { identity, at: clickedAt };
    const body = { shopId: product.shopId, externalProductId: product.externalProductId };
    if (favoriteIds.has(identity)) {
      pendingFavorites.current.delete(identity);
      markFavorite(identity, false);
      setFavoriteSaving(true);
      try {
        await api("personal-remove-current", body);
        publishFavoriteChange();
      } catch (cause) {
        markFavorite(identity, true);
        showFavoriteNotice(cause instanceof Error ? cause.message : "Unable to remove favorite.");
      } finally {
        setFavoriteSaving(false);
      }
      return;
    }
    pendingFavorites.current.add(identity);
    markFavorite(identity, true);
    setFavoriteSaving(true);
    try {
      await api("personal-add-current", body);
      if (!pendingFavorites.current.has(identity)) await api("personal-remove-current", body);
      pendingFavorites.current.delete(identity);
      publishFavoriteChange();
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("not tracked yet")) {
        void (async () => {
          for (let attempt = 0; attempt < 60 && pendingFavorites.current.has(identity); attempt += 1) {
            await wait(3000);
            if (!pendingFavorites.current.has(identity)) return;
            try {
              await api("personal-add-current", body);
              if (!pendingFavorites.current.has(identity)) await api("personal-remove-current", body);
              pendingFavorites.current.delete(identity);
              publishFavoriteChange();
              return;
            } catch (retryCause) {
              if (!(retryCause instanceof Error && retryCause.message.includes("not tracked yet"))) {
                pendingFavorites.current.delete(identity);
                markFavorite(identity, false);
                showFavoriteNotice(retryCause instanceof Error ? retryCause.message : "Unable to save favorite.");
                return;
              }
            }
          }
          if (pendingFavorites.current.has(identity)) {
            pendingFavorites.current.delete(identity);
            markFavorite(identity, false);
            showFavoriteNotice(`Could not save ${identity}. The product was not recorded.`);
          }
        })();
      } else {
        pendingFavorites.current.delete(identity);
        markFavorite(identity, false);
        showFavoriteNotice(cause instanceof Error ? cause.message : "Unable to save favorite.");
      }
    } finally {
      setFavoriteSaving(false);
    }
  }

  const remaining = Math.max(0, summary?.totalDue || 0);

  return <main className="health-page">
    <div className="health-shell">
      <div className="health-heading"><div><span className="health-kicker">PRIVATE ADMIN</span><h1>PriceTrack PH collector</h1><p>Randomly check available Shopee products in one dedicated Chrome tab.</p></div></div>
      <section className="admin-collector-panel">
        <div className="admin-collector-actions">
          <button type="button" onClick={() => void startCollection("normal")} disabled={running || cooldownSeconds > 0 || !summary}>Start collection</button>
          <button type="button" onClick={() => void stopCollection()} disabled={!running}>Stop collection</button>
          <button type="button" onClick={() => void startCollection("unlimited")} disabled={running || !summary}>Start unlimited collection</button>
        </div>
        <div className="admin-collector-queue-options" role="group" aria-label="Collection options">
          {[
            {
              label: "Same Price Products",
              checked: skipUnchangedDay,
              change: (next: boolean) => { setSkipUnchangedDay(next); localStorage.setItem(skipUnchangedStorageKey, String(next)); },
            },
            {
              label: "Sold Out Products",
              checked: skipSoldOut,
              change: (next: boolean) => { setSkipSoldOut(next); localStorage.setItem(skipSoldOutStorageKey, String(next)); },
            },
            {
              label: "Priority Queue",
              checked: includePriorityQueue,
              change: (next: boolean) => { setIncludePriorityQueue(next); localStorage.setItem(includePriorityQueueStorageKey, String(next)); },
            },
            {
              label: "Favorite Queue",
              checked: includePersonalQueue,
              change: (next: boolean) => { setIncludePersonalQueue(next); localStorage.setItem(includePersonalQueueStorageKey, String(next)); },
            },
            {
              label: "Store Queue",
              checked: includeStoreImports,
              change: (next: boolean) => { setIncludeStoreImports(next); localStorage.setItem(includeStoreImportsStorageKey, String(next)); },
            },
            {
              label: "Normal Queue",
              checked: includeNormalQueue,
              change: (next: boolean) => { setIncludeNormalQueue(next); localStorage.setItem(includeNormalQueueStorageKey, String(next)); },
            },
          ].map((option) => <button type="button" className="admin-collector-option-button" key={option.label}
            aria-pressed={option.checked} disabled={running}
            onClick={() => option.change(!option.checked)}>{option.label}</button>)}
        </div>
        <div className="admin-collector-status admin-collector-status-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }} aria-live="polite">
          {[
            ["Total Products", summary?.totalTracked ?? "—"],
            ["Total Available", summary?.totalDue ?? "—"],
            ["Total Sold Out", summary?.soldOutDeferred ?? "—"],
            ["Total Same Price", summary?.samePriceDeferred ?? "—"],
            ["Total Priority Queue", summary?.priorityPending ?? "—"],
            ["Total Store Queue", summary?.storeQueuePending ?? "—"],
          ].map(([label, value]) => (
            <div className="admin-collector-status-card" style={collectorStatusCardStyle} key={label}>
              <small>{label}</small>
              <strong>{formatCollectorCount(value)}</strong>
            </div>
          ))}
          {[
            ["Remaining", summary ? remaining : "—"],
            ["Processing", currentProduct ? 1 : 0],
          ].map(([label, value]) => (
            <div className="admin-collector-status-card" style={collectorStatusCardStyle} key={label}>
              <small>{label}</small>
              <strong>{formatCollectorCount(value)}</strong>
            </div>
          ))}
          <button type="button" className={`admin-collector-status-card admin-collector-status-message${message.length > 32 || cooldownSeconds > 0 ? " admin-collector-status-long" : ""}`} style={{ ...collectorStatusCardStyle, gridColumn: "3 / span 2", width: "100%", font: "inherit", cursor: currentProduct ? "pointer" : "default" }} disabled={!currentProduct || favoriteSaving || !favoritesLoaded} onClick={() => void saveCurrentFavorite()} title={currentProduct ? "Save current product to Favorite Queue" : "No product is currently being collected"}>
            <small>Status</small>
            <strong>{cooldownSeconds > 0
              ? `Next collection available in ${Math.floor(cooldownSeconds / 3600)}h ${Math.floor((cooldownSeconds % 3600) / 60)}m ${cooldownSeconds % 60}s`
              : currentProduct && favoriteIds.has(`${currentProduct.shopId}.${currentProduct.externalProductId}`) && message === `Opening ${currentProduct.shopId}.${currentProduct.externalProductId}`
                ? `Opening ⭐ ${currentProduct.shopId}.${currentProduct.externalProductId}`
                : message}</strong>
          </button>
          {[
            ["Succeeded", succeeded],
            ["Failed", failed],
          ].map(([label, value]) => (
            <div className="admin-collector-status-card" style={collectorStatusCardStyle} key={label}>
              <small>{label}</small>
              <strong>{formatCollectorCount(value)}</strong>
            </div>
          ))}
          {[
            ["Doesn't Exist", summary?.doesNotExistCount ?? "—"],
            ["Unlisted", summary?.unlistedCount ?? "—"],
            ["Page Error", summary?.pageErrorCount ?? "—"],
          ].map(([label, value]) => (
            <div className="admin-collector-status-card" style={{ ...collectorStatusCardStyle, gridColumn: "span 2" }} key={label}>
              <small>{label}</small>
              <strong>{formatCollectorCount(value)}</strong>
            </div>
          ))}
        </div>
        {favoriteNotice && <p className="admin-collector-remote-notice" role="status">{favoriteNotice}</p>}
        <p className="admin-collector-note">Keep this page and the dedicated Shopee tab open. Complete Shopee verification manually if it appears.</p>
        {remoteNotice && <p className="admin-collector-remote-notice" role="status">{remoteNotice}</p>}
      </section>
      <section className="health-events admin-collector-history">
        <h2>Collection history</h2>
        {history.length === 0 ? <p className="health-empty">No stopped collection runs yet.</p> : <div className="health-table-wrap admin-history-scroll" onScroll={(event) => { const node = event.currentTarget; if (node.scrollTop + node.clientHeight >= node.scrollHeight - 160) void loadMoreHistory(); }}><table>
          <thead><tr><th>Time</th><th>Running time</th><th>Succeeded</th><th>Failed</th><th>Sold out</th><th>Same Price</th><th>Remaining</th><th>Status</th></tr></thead>
          <tbody>{history.map((run) => <tr key={run.runId}>
            <td>{new Date(run.startedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
            <td>{Math.floor(run.durationSeconds / 3600)}h {Math.floor((run.durationSeconds % 3600) / 60)}m {run.durationSeconds % 60}s</td>
            <td>{run.succeeded}</td><td>{run.failed}</td>
            <td>{run.soldOut}{run.recheckAt ? ` — ${new Date(run.recheckAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit" })}` : ""}</td>
            <td>{run.samePrice}{run.samePriceRecheckAt ? ` — ${new Date(run.samePriceRecheckAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", year: "2-digit", month: "2-digit", day: "2-digit" })}` : ""}</td>
            <td>{run.remaining}</td>
            <td>{stopStatusLabel(run.stopStatus)}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>
  </main>;
}
