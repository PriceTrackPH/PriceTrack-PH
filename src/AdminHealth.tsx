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
export default function AdminHealth() {
  const [token, setToken] = useState(() => sessionStorage.getItem("pricetrack-admin-health-token") || "");
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      if (!response.ok) throw new Error(response.status === 401 ? "That admin token is not valid." : payload.error || "Unable to load diagnostics.");
      sessionStorage.setItem("pricetrack-admin-health-token", nextToken);
      setData(payload as HealthData);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Unable to load diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void load(token);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  const isHealthy = Boolean(data && data.summary.failures === 0 && data.summary.partial === 0);

  return (
    <main className="health-page">
      <div className="health-shell">
        <div className="health-heading">
          <div>
            <span className="health-kicker">PRIVATE ADMIN</span>
            <h1>PriceTrack PH health</h1>
            <p>Sanitized recording diagnostics retained for 30 days.</p>
          </div>
          <a href="/">Back to PriceTrack PH</a>
        </div>

        {!data ? (
          <form className="health-login" onSubmit={handleSubmit}>
            <label htmlFor="health-token">Admin access token</label>
            <div>
              <input id="health-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" />
              <button disabled={loading || !token}>{loading ? "Checking…" : "Open dashboard"}</button>
            </div>
            {error && <p role="alert">{error}</p>}
          </form>
        ) : (
          <>
            <section className={`health-status ${isHealthy ? "healthy" : "attention"}`}>
              <strong>{isHealthy ? "Recording looks healthy" : "Review recent recording issues"}</strong>
              <span>Last successful recording: {dateLabel(data.summary.lastSuccess)}</span>
              <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            </section>

            <section className="health-stats" aria-label="30-day diagnostic summary">
              <div><span>Events</span><strong>{data.summary.total}</strong></div>
              <div><span>Failures</span><strong>{data.summary.failures}</strong></div>
              <div><span>Partial</span><strong>{data.summary.partial}</strong></div>
              <div><span>Duplicates blocked</span><strong>{data.summary.duplicates}</strong></div>
              <div><span>Variation changes</span><strong>{data.summary.variationChanges}</strong></div>
            </section>

            <section className="health-events">
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
            </section>
          </>
        )}
      </div>
    </main>
  );
}
