import { FormEvent, useEffect, useState } from "react";

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
  configured: boolean;
  updatedAt: string | null;
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
  view?: "login" | "health" | "affiliate" | "ads";
};

export default function AdminHealth({ view = "health" }: AdminHealthProps) {
  const [token, setToken] = useState(() => sessionStorage.getItem("pricetrack-admin-health-token") || "");
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [affiliateSummary, setAffiliateSummary] = useState<AffiliateSummary | null>(null);
  const [affiliateError, setAffiliateError] = useState("");
  const [affiliateBusy, setAffiliateBusy] = useState<"export" | "import" | "">("");
  const [importResult, setImportResult] = useState<AffiliateImportResult | null>(null);
  const [driveArchiveMessage, setDriveArchiveMessage] = useState("");
  const [adSettings, setAdSettings] = useState<AdSettings | null>(null);
  const [adsBusy, setAdsBusy] = useState(false);
  const [adsMessage, setAdsMessage] = useState("");
  const isLogin = view === "login";

  useEffect(() => {
    document.body.classList.add("admin-page-active");
    return () => document.body.classList.remove("admin-page-active");
  }, []);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
    if (links.length < 2) return;

    const [healthLink, affiliateLink] = links;
    const adsLink = document.createElement("a");
    affiliateLink.after(adsLink);
    const adminLinks = [healthLink, affiliateLink, adsLink];
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
    adsLink.textContent = "Ads";
    adsLink.href = "/admin/ads";
    if (!isLogin) (view === "affiliate" ? affiliateLink : view === "ads" ? adsLink : healthLink).setAttribute("aria-current", "page");

    return () => {
      adsLink.remove();
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

  async function loadAdSettings(nextToken = token) {
    if (!nextToken) return;
    const response = await fetch("/api/site-settings", {
      headers: { Authorization: `Bearer ${nextToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load ad settings.");
    setAdSettings(payload as AdSettings);
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
      if (view === "ads") void loadAdSettings(nextToken).catch((cause) => setAdsMessage(cause instanceof Error ? cause.message : "Unable to load ad settings."));
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Unable to load diagnostics.");
    } finally {
      setLoading(false);
    }
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

  const isHealthy = Boolean(data && data.summary.failures === 0 && data.summary.partial === 0);
  const isAffiliate = view === "affiliate";
  const isAds = view === "ads";

  return (
    <main className="health-page">
      <div className="health-shell">
        <div className="health-heading">
          <div>
            <span className="health-kicker">PRIVATE ADMIN</span>
            <h1>PriceTrack PH {isLogin ? "admin" : isAffiliate ? "affiliate" : isAds ? "ads" : "health"}</h1>
            <p>{isLogin ? "Enter your admin access token to continue." : isAffiliate ? "Shopee affiliate-link batch tools." : isAds ? "Global advertising control for every visitor." : "Recording-system status and sanitized events retained for 30 days."}</p>
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

            {isAds && <section className="health-ads" aria-labelledby="ads-heading">
              <div>
                <span className="health-kicker">GLOBAL AD CONTROL</span>
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

            {!isAffiliate && !isAds && <section className={`health-status ${isHealthy ? "healthy" : "attention"}`}>
              <strong>{isHealthy ? "Recording looks healthy" : "Review recent recording issues"}</strong>
              <span>Last successful recording: {dateLabel(data.summary.lastSuccess)}</span>
              <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            </section>}

            {!isAffiliate && !isAds && <section className="health-stats" aria-label="30-day diagnostic summary">
              <div><span>Events</span><strong>{data.summary.total}</strong></div>
              <div><span>Failures</span><strong>{data.summary.failures}</strong></div>
              <div><span>Partial</span><strong>{data.summary.partial}</strong></div>
              <div><span>Duplicates blocked</span><strong>{data.summary.duplicates}</strong></div>
              <div><span>Variation changes</span><strong>{data.summary.variationChanges}</strong></div>
            </section>}

            {!isAffiliate && !isAds && <section className="health-events">
              <div className="health-events-heading">
                <h2>Recent events</h2>
                <span>Latest 50 · no personal data or full URLs</span>
              </div>
              {data.events.length ? (
                <div className="health-table-wrap">
                  <table>
                    <thead><tr><th>Time</th><th>Event</th><th>Product</th><th>Variations</th><th>Result</th></tr></thead>
                    <tbody>
                      {data.events.map((event) => (
                        <tr key={event.id}>
                          <td>{dateLabel(event.created_at)}</td>
                          <td><span className={`health-event-type ${event.event_type}`}>{eventLabels[event.event_type] || event.event_type}</span></td>
                          <td>{event.shop_id && event.product_id ? `${event.shop_id}.${event.product_id}` : "—"}</td>
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
