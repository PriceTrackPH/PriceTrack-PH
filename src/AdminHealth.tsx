import { FormEvent, useEffect, useState } from "react";
import { healthProductLinkProps } from "./admin-product-link.js";

type HealthEvent = {
  id: number;
  created_at: string;
  event_type: string;
  source: string;
  shop_id: string | null;
  product_id: string | null;
  variation_count: number | null;
  recorded_count: number | null;
  unchanged_count: number | null;
  failed_count: number | null;
  status_code: number | null;
  error_code: string | null;
};

type HealthData = {
  generatedAt: string;
  windowDays: number;
  summary: {
    total: number;
    failures: number;
    partial: number;
    duplicates: number;
    variationChanges: number;
    lastSuccess: string | null;
  };
  events: HealthEvent[];
  hasMore: boolean;
};

type AffiliateSummary = {
  total: number;
  withAffiliate: number;
  missing: number;
};

type AffiliateImportResult = {
  updated: number;
  skippedExisting: number;
  notFound: number;
  failed: number;
  invalid: number;
  driveArchive: "saved" | "failed" | "not-configured";
};

type AdSettings = {
  adsEnabled: boolean;
  requestedEnabled: boolean;
  shopeeLinkEnabled: boolean;
  affiliateLinkEnabled: boolean;
  configured: boolean;
  updatedAt: string | null;
};

type FavoriteProduct = {
  product_id: number;
  products: { product_url: string };
};

const eventLabels: Record<string, string> = {
  record_success: "Recorded",
  record_partial: "Partial failure",
  record_failure: "Failed",
  duplicate_blocked: "Duplicate blocked",
  variation_count_changed: "Variation count changed",
};

function dateLabel(value: string | null) {
  if (!value) return "None in 30 days";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}
type AdminHealthProps = {
  view?: "login" | "health" | "affiliate" | "settings";
};

export default function AdminHealth({ view = "health" }: AdminHealthProps) {
  const [token, setToken] = useState(() => sessionStorage.getItem("pricetrack-admin-health-token") || "");
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [affiliateSummary, setAffiliateSummary] = useState<AffiliateSummary | null>(null);
  const [affiliateError, setAffiliateError] = useState("");
  const [affiliateBusy, setAffiliateBusy] = useState<"export" | "import" | "">("");
  const [importResult, setImportResult] = useState<AffiliateImportResult | null>(null);
  const [driveArchiveMessage, setDriveArchiveMessage] = useState("");
  const [adSettings, setAdSettings] = useState<AdSettings | null>(null);
  const [adsBusy, setAdsBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState<"shopeeLinkEnabled" | "affiliateLinkEnabled" | null>(null);
  const [adsMessage, setAdsMessage] = useState("");
  const [favoriteUrl, setFavoriteUrl] = useState("");
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState("");
  const isLogin = view === "login";

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    return () => document.body.classList.remove("admin-page-active");
  }, []);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
    if (links.length < 2) return;

    const [healthLink, affiliateLink] = links;
    const settingsLink = document.createElement("a");
    const collectorLink = document.createElement("a");
    const scannerLink = document.createElement("a");
    affiliateLink.after(collectorLink, scannerLink, settingsLink);
    const adminLinks = [healthLink, affiliateLink, settingsLink, collectorLink, scannerLink];
    const original = [healthLink, affiliateLink].map((link) => ({
      text: link.textContent || "",
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
      scrollTarget: link.getAttribute("data-scroll-target"),
      current: link.getAttribute("aria-current"),
    }));

    healthLink.textContent = "Health";
    healthLink.href = "/admin/health";
    healthLink.removeAttribute("data-scroll-target");
    affiliateLink.textContent = "Affiliate";
    affiliateLink.href = "/admin/affiliate";
    affiliateLink.removeAttribute("target");
    affiliateLink.removeAttribute("rel");
    affiliateLink.removeAttribute("data-scroll-target");
    healthLink.removeAttribute("aria-current");
    affiliateLink.removeAttribute("aria-current");
    settingsLink.textContent = "Settings";
    settingsLink.href = "/admin/settings";
    collectorLink.textContent = "Collector";
    collectorLink.href = "/admin/collector";
    scannerLink.textContent = "Store Scanner";
    scannerLink.href = "/admin/store-scanner";
    if (!isLogin) (view === "affiliate" ? affiliateLink : view === "settings" ? settingsLink : healthLink).setAttribute("aria-current", "page");

    return () => {
      settingsLink.remove();
      collectorLink.remove();
      scannerLink.remove();
      adminLinks.slice(0, 2).forEach((link, index) => {
        const saved = original[index];
        link.textContent = saved.text;
        for (const [name, value] of Object.entries({
          href: saved.href,
          target: saved.target,
          rel: saved.rel,
          "data-scroll-target": saved.scrollTarget,
          "aria-current": saved.current,
        })) {
          if (value === null) link.removeAttribute(name);
          else link.setAttribute(name, value);
        }
      });
    };
  }, [isLogin, view]);

  async function loadSiteSettings(nextToken = token) {
    if (!nextToken) return;
    const response = await fetch("/api/site-settings", {
      headers: { Authorization: `Bearer ${nextToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load site settings.");
    setAdSettings(payload as AdSettings);
  }

  async function favoriteRequest<T>(action: string, body: Record<string, unknown> = {}, nextToken = token): Promise<T> {
    const response = await fetch(`/api/admin-pc-collector?action=${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nextToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem("pricetrack-admin-health-token");
      window.location.replace("/admin");
      throw new Error("Admin login expired.");
    }
    if (!response.ok) throw new Error(payload.error || "Unable to update Favorite Queue.");
    return payload as T;
  }

  async function loadFavorites(nextToken = token) {
    setFavoriteLoading(true);
    try {
      const result = await favoriteRequest<{ favorites: FavoriteProduct[] }>("personal-list", {}, nextToken);
      setFavorites(result.favorites);
      setFavoriteMessage("");
    } catch (cause) {
      setFavoriteMessage(cause instanceof Error ? cause.message : "Unable to load Favorite Queue.");
    } finally { setFavoriteLoading(false); }
  }

  async function addFavorite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFavoriteBusy(true);
    setFavoriteMessage("");
    try {
      await favoriteRequest("personal-add", { productUrl: favoriteUrl.trim() });
      setFavoriteUrl("");
      await loadFavorites();
      setFavoriteMessage("Product saved to Favorite Queue.");
    } catch (cause) {
      setFavoriteMessage(cause instanceof Error ? cause.message : "Unable to save product.");
    } finally { setFavoriteBusy(false); }
  }

  async function removeFavorite(productId: number) {
    setFavoriteBusy(true);
    setFavoriteMessage("");
    try {
      await favoriteRequest("personal-remove", { productId });
      await loadFavorites();
      setFavoriteMessage("Product removed from Favorite Queue.");
    } catch (cause) {
      setFavoriteMessage(cause instanceof Error ? cause.message : "Unable to remove product.");
    } finally { setFavoriteBusy(false); }
  }

  async function loadAffiliateSummary(nextToken = token) {
    if (!nextToken) return;
    try {
      const response = await fetch("/api/admin-affiliate-links", {
        headers: { Authorization: `Bearer ${nextToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to load affiliate-link totals.");
      setAffiliateSummary(payload as AffiliateSummary);
      setAffiliateError("");
    } catch (cause) {
      setAffiliateSummary(null);
      setAffiliateError(cause instanceof Error ? cause.message : "Unable to load affiliate-link totals.");
    }
  }

  async function load(nextToken = token) {
    if (!nextToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin-health", {
        headers: { Authorization: `Bearer ${nextToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = response.status === 401 ? "That admin token is not valid." : payload.error || "Unable to load diagnostics.";
        if (response.status === 401 && !isLogin) {
          sessionStorage.removeItem("pricetrack-admin-health-token");
          window.location.replace("/admin");
          return;
        }
        throw new Error(message);
      }
      sessionStorage.setItem("pricetrack-admin-health-token", nextToken);
      if (isLogin) {
        window.location.replace("/admin/health");
        return;
      }
      setData(payload as HealthData);
      if (view === "affiliate") void loadAffiliateSummary(nextToken);
      if (view === "settings") {
        void loadSiteSettings(nextToken).catch((cause) => setAdsMessage(cause instanceof Error ? cause.message : "Unable to load ad settings."));
        void loadFavorites(nextToken);
      }
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Unable to load diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreEvents() {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/admin-health?offset=${data.events.length}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load more events.");
      setData((current) => current ? { ...current, events: [...current.events, ...payload.events], hasMore: payload.hasMore } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more events.");
    } finally { setLoadingMore(false); }
  }

  useEffect(() => {
    if (isLogin) {
      if (token) void load(token);
      return;
    }
    if (!token) {
      window.location.replace("/admin");
      return;
    }
    void load(token);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  async function exportMissingLinks() {
    setAffiliateBusy("export");
    setAffiliateError("");
    setDriveArchiveMessage("");
    try {
      const response = await fetch("/api/admin-affiliate-links?action=export", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to export missing affiliate links.");
      }
      const driveArchive = response.headers.get("X-PriceTrack-Drive-Archive");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `PriceTrack-PH-Missing-Affiliate-Links-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      setDriveArchiveMessage(
        driveArchive === "saved"
          ? "XLSX downloaded and backed up to Google Drive."
          : driveArchive === "failed"
            ? "XLSX downloaded, but its Google Drive backup failed."
            : "XLSX downloaded. Google Drive backup is not configured yet.",
      );
    } catch (cause) {
      setAffiliateError(cause instanceof Error ? cause.message : "Unable to export missing affiliate links.");
    } finally {
      setAffiliateBusy("");
    }
  }

  async function importShopeeResults(file: File | null) {
    if (!file) return;
    setAffiliateBusy("import");
    setAffiliateError("");
    setImportResult(null);
    setDriveArchiveMessage("");
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Select the CSV downloaded from Shopee Export Management.");
      const csvText = await file.text();
      const response = await fetch("/api/admin-affiliate-links", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ csvText, fileName: file.name }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to import Shopee results.");
      setImportResult(payload as AffiliateImportResult);
      setDriveArchiveMessage(
        payload.driveArchive === "saved"
          ? "CSV imported and backed up to Google Drive."
          : payload.driveArchive === "failed"
            ? "CSV imported, but its Google Drive backup failed."
            : "CSV imported. Google Drive backup is not configured yet.",
      );
      await loadAffiliateSummary();
    } catch (cause) {
      setAffiliateError(cause instanceof Error ? cause.message : "Unable to import Shopee results.");
    } finally {
      setAffiliateBusy("");
    }
  }

  async function updateAds(enabled: boolean) {
    setAdsBusy(true);
    setAdsMessage("");
    try {
      const response = await fetch("/api/site-settings", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ adsEnabled: enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update ads.");
      setAdSettings(payload as AdSettings);
      setAdsMessage(enabled && !payload.configured ? "Saved as ON, but ads will remain hidden until the AdSense IDs are configured." : `Ads are now ${enabled ? "ON" : "OFF"} for everyone.`);
    } catch (cause) {
      setAdsMessage(cause instanceof Error ? cause.message : "Unable to update ads.");
    } finally {
      setAdsBusy(false);
    }
  }

  async function updateLink(field: "shopeeLinkEnabled" | "affiliateLinkEnabled", enabled: boolean) {
    setLinkBusy(field);
    setAdsMessage("");
    try {
      const response = await fetch("/api/site-settings", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update link visibility.");
      setAdSettings(payload as AdSettings);
      setAdsMessage(`${field === "shopeeLinkEnabled" ? "Shopee" : "Affiliate"} link is now ${enabled ? "shown" : "hidden"}.`);
    } catch (cause) {
      setAdsMessage(cause instanceof Error ? cause.message : "Unable to update link visibility.");
    } finally {
      setLinkBusy(null);
    }
  }

  const isHealthy = Boolean(data && data.summary.failures === 0 && data.summary.partial === 0);
  const isAffiliate = view === "affiliate";
  const isSettings = view === "settings";

  return (
    <main className="health-page">
      <div className="health-shell">
        <div className="health-heading">
          <div>
            <span className="health-kicker">PRIVATE ADMIN</span>
            <h1>PriceTrack PH {isLogin ? "admin" : isAffiliate ? "affiliate" : isSettings ? "settings" : "health"}</h1>
            <p>{isLogin ? "Enter your admin access token to continue." : isAffiliate ? "Shopee affiliate-link batch tools." : isSettings ? "Control public product links and advertising." : "Recording-system status and sanitized events retained for 30 days."}</p>
          </div>
        </div>

        {isLogin ? (
          <form className="health-login" onSubmit={handleSubmit}>
            <label htmlFor="health-token">Admin access token</label>
            <div>
              <input id="health-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" />
              <button disabled={loading || !token}>{loading ? "Checking…" : "Open dashboard"}</button>
            </div>
            {error && <p role="alert">{error}</p>}
          </form>
        ) : !data ? (
          <div className="health-empty">{loading ? "Opening dashboard…" : error || "Opening dashboard…"}</div>
        ) : (
          <>
            {isAffiliate && <section className="health-affiliate" aria-labelledby="affiliate-links-heading">
              <div className="health-affiliate-copy">
                <span className="health-kicker">SHOPEE AFFILIATE BATCH</span>
                <h2 id="affiliate-links-heading">Affiliate links</h2>
                <p>Export unconverted Shopee products, upload the workbook to Shopee Custom Link, then import Shopee’s result CSV.</p>
              </div>
              <div className="health-affiliate-count">
                <span>Products missing affiliate links</span>
                <strong>{affiliateSummary ? affiliateSummary.missing : "—"}</strong>
                {affiliateSummary && <small>{affiliateSummary.withAffiliate} of {affiliateSummary.total} already converted</small>}
              </div>
              <div className="health-affiliate-actions">
                <button type="button" onClick={() => void exportMissingLinks()} disabled={affiliateBusy !== "" || !affiliateSummary?.missing}>
                  {affiliateBusy === "export" ? "Preparing…" : "Export missing links (.xlsx)"}
                </button>
                <label className={affiliateBusy !== "" ? "disabled" : ""}>
                  {affiliateBusy === "import" ? "Importing…" : "Import Shopee result (.csv)"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={affiliateBusy !== ""}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      event.currentTarget.value = "";
                      void importShopeeResults(file);
                    }}
                  />
                </label>
              </div>
              {affiliateError && <p className="health-affiliate-message error" role="alert">{affiliateError}</p>}
              {driveArchiveMessage && (
                <p className={`health-affiliate-message ${driveArchiveMessage.includes("failed") || driveArchiveMessage.includes("not configured") ? "error" : "success"}`} role="status">
                  {driveArchiveMessage}
                </p>
              )}
              {importResult && (
                <p className="health-affiliate-message success" role="status">
                  Import complete: {importResult.updated} updated · {importResult.skippedExisting} existing skipped · {importResult.notFound} not found · {importResult.failed} Shopee failures · {importResult.invalid} invalid
                </p>
              )}
            </section>}

            {isSettings && <section className="health-ads" aria-labelledby="link-settings-heading">
              <div>
                <span className="health-kicker">PUBLIC PRODUCT LINKS</span>
                <h2 id="link-settings-heading">Link visibility</h2>
                <p>Choose which buttons appear on public product reports.</p>
              </div>
              <div className="admin-settings-links">
                {([
                  ["shopeeLinkEnabled", "Shopee link"],
                  ["affiliateLinkEnabled", "Affiliate link"],
                ] as const).map(([field, label]) => (
                  <div className="admin-settings-link" key={field}>
                    <span>{label}</span>
                    <button type="button" disabled={!adSettings || linkBusy !== null} aria-pressed={adSettings?.[field] ?? true} onClick={() => void updateLink(field, !adSettings?.[field])}>
                      {linkBusy === field ? "Saving…" : adSettings?.[field] === false ? "Off · Hidden" : "On · Shown"}
                    </button>
                  </div>
                ))}
              </div>
            </section>}

            {isSettings && <section className="health-ads" aria-labelledby="ads-heading">
              <div>
                <span className="health-kicker">ADVERTISING</span>
                <h2 id="ads-heading">Report advertisement</h2>
                <p>One responsive ad below a successfully loaded Database Product Report. It is hidden on errors and untracked products.</p>
              </div>
              <div className="health-ads-control">
                <span className={`health-ads-status ${adSettings?.adsEnabled ? "on" : "off"}`}>{adSettings?.adsEnabled ? "ADS ON" : "ADS OFF"}</span>
                <button type="button" disabled={adsBusy || !adSettings} onClick={() => void updateAds(!adSettings?.requestedEnabled)}>
                  {adsBusy ? "Saving…" : adSettings?.requestedEnabled ? "Turn ads off" : "Turn ads on"}
                </button>
              </div>
              <div className="health-ads-details">
                <span>AdSense code</span>
                <strong>{adSettings?.configured ? "Configured" : "Not configured"}</strong>
                <small>The switch affects every website visitor immediately.</small>
              </div>
              {adsMessage && <p className="health-ads-message" role="status">{adsMessage}</p>}
            </section>}

            {isSettings && <section className="health-ads admin-favorites" aria-labelledby="favorites-heading">
              <div>
                <span className="health-kicker">COLLECTOR</span>
                <h2 id="favorites-heading">Favorite Queue</h2>
                <p>Save tracked Shopee products for repeat checks in the collector.</p>
              </div>
              <form onSubmit={(event) => void addFavorite(event)} className="admin-favorites-form">
                <label htmlFor="favorite-product-url">Shopee product link</label>
                <div><input id="favorite-product-url" type="url" placeholder="https://shopee.ph/product/123/456" value={favoriteUrl}
                  onChange={(event) => setFavoriteUrl(event.target.value)} required />
                  <button type="submit" disabled={favoriteBusy || favoriteLoading}>Save product</button></div>
              </form>
              <div className="admin-favorites-list">
                {favoriteLoading ? <p>Loading saved products…</p> : favorites.length === 0 ? <p>No saved products yet.</p> :
                  favorites.map((favorite) => <div key={favorite.product_id}>
                    <a href={favorite.products.product_url} target="_blank" rel="noreferrer">{favorite.products.product_url}</a>
                    <button type="button" disabled={favoriteBusy} onClick={() => void removeFavorite(favorite.product_id)}>Remove</button>
                  </div>)}
              </div>
              {favoriteMessage && <p className="admin-favorites-message" role="status">{favoriteMessage}</p>}
            </section>}

            {!isAffiliate && !isSettings && <section className={`health-status ${isHealthy ? "healthy" : "attention"}`}>
              <strong>{isHealthy ? "Recording looks healthy" : "Review recent recording issues"}</strong>
              <span>Last successful recording: {dateLabel(data.summary.lastSuccess)}</span>
              <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            </section>}

            {!isAffiliate && !isSettings && <section className="health-stats" aria-label="30-day diagnostic summary">
              <div><span>Events</span><strong>{data.summary.total}</strong></div>
              <div><span>Failures</span><strong>{data.summary.failures}</strong></div>
              <div><span>Partial</span><strong>{data.summary.partial}</strong></div>
              <div><span>Duplicates blocked</span><strong>{data.summary.duplicates}</strong></div>
              <div><span>Variation changes</span><strong>{data.summary.variationChanges}</strong></div>
            </section>}

            {!isAffiliate && !isSettings && <section className="health-events">
              <div className="health-events-heading">
                <h2>Recent events</h2>
                <span>Last 30 days · no personal data or full URLs</span>
              </div>
              {data.events.length ? (
                <div className="health-table-wrap admin-history-scroll" onScroll={(event) => { const node = event.currentTarget; if (node.scrollTop + node.clientHeight >= node.scrollHeight - 160) void loadMoreEvents(); }}>
                  <table>
                    <thead><tr><th>Time</th><th>Event</th><th>Product</th><th>Variations</th><th>Result</th></tr></thead>
                    <tbody>
                      {data.events.map((event) => (
                        <tr key={event.id}>
                          <td>{dateLabel(event.created_at)}</td>
                          <td><span className={`health-event-type ${event.event_type}`}>{eventLabels[event.event_type] || event.event_type}</span></td>
                          <td>{(() => {
                            const link = healthProductLinkProps(event.shop_id, event.product_id);
                            return link
                              ? <a {...link} className="health-product-link">{event.shop_id}.{event.product_id}</a>
                              : "—";
                          })()}</td>
                          <td>{event.variation_count ?? "—"}</td>
                          <td>{event.error_code || `${event.recorded_count ?? 0} recorded · ${event.unchanged_count ?? 0} unchanged`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="health-empty">No diagnostic events have been recorded yet.</div>}
            </section>}
          </>
        )}
      </div>
    </main>
  );
}
