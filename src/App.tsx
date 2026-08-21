import { FormEvent, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Tables } from "./database.types";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type Product = Tables<"products">;
type Variation = Tables<"product_variations">;
type Observation = Tables<"price_observations">;
type RangeKey = "7D" | "30D" | "90D" | "ALL";

type ChartPoint = {
  price: number;
  timestamp: number;
  label: string;
  fullDate: string;
};

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const sampleHistory: ChartPoint[] = [
  [0, 699],
  [4, 689],
  [8, 679],
  [12, 649],
  [16, 699],
  [20, 679],
  [24, 679],
  [27, 699],
  [29, 699],
].map(([daysAgo, price]) => {
  const timestamp = Date.now() - Number(daysAgo) * 86_400_000;
  const date = new Date(timestamp);
  return {
    price: Number(price),
    timestamp,
    label: date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
    fullDate: date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }),
  };
}).sort((a, b) => a.timestamp - b.timestamp);

function parseShopeeUrl(value: string) {
  const url = new URL(value.trim());
  if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) {
    throw new Error("Please paste a Shopee Philippines product link.");
  }
  const match =
    url.pathname.match(/-i\.(\d+)\.(\d+)/i) ||
    url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
  if (!match) throw new Error("Could not find the Shopee shop and product IDs in that link.");
  return { shopId: match[1], productId: match[2] };
}

function latestObservation(rows: Observation[], variationId: number) {
  return rows
    .filter((row) => row.variation_id === variationId)
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
}

function App() {
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("30D");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProduct(shopId: string, productId: string) {
    if (!supabase) throw new Error("Supabase is not configured yet.");

    const { data: found, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("platform", "shopee")
      .eq("external_shop_id", shopId)
      .eq("external_product_id", productId)
      .maybeSingle();

    if (productError) throw productError;
    if (!found) throw new Error("This product has not been recorded by PriceTrack yet.");

    const { data: models, error: variationError } = await supabase
      .from("product_variations")
      .select("*")
      .eq("product_id", found.id)
      .order("name");

    if (variationError) throw variationError;
    const modelRows = models ?? [];

    const ids = modelRows.map((item) => item.id);
    let history: Observation[] = [];
    if (ids.length) {
      const { data, error: observationError } = await supabase
        .from("price_observations")
        .select("*")
        .in("variation_id", ids)
        .order("observed_at", { ascending: true });
      if (observationError) throw observationError;
      history = data ?? [];
    }

    const defaultVariation = modelRows
      .map((item) => ({ item, latest: latestObservation(history, item.id) }))
      .filter((entry) => entry.latest)
      .sort((a, b) => Number(a.latest!.price) - Number(b.latest!.price))[0]?.item;

    setProduct(found);
    setVariations(modelRows);
    setObservations(history);
    setSelectedVariationId(defaultVariation?.id ?? modelRows[0]?.id ?? null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const ids = parseShopeeUrl(query);
      await loadProduct(ids.shopId, ids.productId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this product.");
    } finally {
      setLoading(false);
    }
  }

  const selectedVariation = variations.find((item) => item.id === selectedVariationId) ?? null;

  const selectedHistory = useMemo(() => {
    if (selectedVariationId == null) return [];
    const now = Date.now();
    const days = range === "ALL" ? null : Number(range.replace("D", ""));
    return observations.filter((row) => {
      if (row.variation_id !== selectedVariationId) return false;
      return days == null || Date.parse(row.observed_at) >= now - days * 86_400_000;
    });
  }, [observations, range, selectedVariationId]);

  const liveChartData: ChartPoint[] = selectedHistory.map((row) => ({
    price: Number(row.price),
    timestamp: Date.parse(row.observed_at),
    label: new Date(row.observed_at).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
    }),
    fullDate: new Date(row.observed_at).toLocaleString("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  }));

  const isSample = !product;
  const chartData = isSample ? sampleHistory : liveChartData;
  const reportVariationName = isSample ? "Black" : selectedVariation?.name ?? "Default";

  const reportStats = useMemo(() => {
    if (!chartData.length) return null;
    const prices = chartData.map((row) => row.price);
    const latest = prices[prices.length - 1];
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    return {
      latest,
      low,
      high,
      average,
      observations: prices.length,
      aboveLow: Math.max(0, latest - low),
    };
  }, [chartData]);

  const axisDomain = useMemo<[number, number]>(() => {
    if (!chartData.length) return [0, 100];
    const prices = chartData.map((row) => row.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const spread = Math.max(1, high - low);
    const padding = Math.max(spread * 0.22, high * 0.025, 1);
    return [Math.max(0, Math.floor(low - padding)), Math.ceil(high + padding)];
  }, [chartData]);

  const verdict = useMemo(() => {
    if (!reportStats) return { label: "PRICE STATUS", title: "No history yet", detail: "Waiting for recorded observations." };
    if (reportStats.latest <= reportStats.low * 1.05) {
      return {
        label: "GOOD PRICE",
        title: "Near its lowest",
        detail: reportStats.aboveLow === 0
          ? "At the recorded low."
          : `${peso.format(reportStats.aboveLow)} above the recorded low.`,
      };
    }
    if (reportStats.latest <= reportStats.average) {
      return {
        label: "GOOD PRICE",
        title: "Below average",
        detail: `${peso.format(reportStats.average - reportStats.latest)} below the selected-period average.`,
      };
    }
    return {
      label: "CHECK PRICE",
      title: "Above average",
      detail: `${peso.format(reportStats.latest - reportStats.average)} above the selected-period average.`,
    };
  }, [reportStats]);

  return (
    <div className="app-shell">
      <main>
        <section className="hero-band">
          <div className="hero-inner">
            <div className="eyebrow">— &nbsp; INDEPENDENT PRICE TRACKER</div>
            <h1>
              Know if the Shopee<br />
              sale is <em>really</em> a sale.
            </h1>
            <p>
              Paste any Shopee product link to see today's price, its recorded low and high, and
              how the price changed over time.
            </p>

            <form className="search-box" onSubmit={handleSubmit}>
              <span className="link-mark">◇</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Paste a Shopee product link..."
                aria-label="Shopee product link"
              />
              <button disabled={loading || !query.trim()}>
                {loading ? "Checking…" : "Check price"}
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <div className="trust-row" aria-label="PriceTrack promises">
              <span>✓ No sign-up needed</span>
              <span>✓ Public prices only</span>
              <span>✓ Transparent tracking</span>
            </div>

            {!hasSupabaseConfig && (
              <div className="notice">
                Local setup needed: add your Supabase publishable key to <code>.env.local</code>.
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        </section>

        <section className="report-section">
          <div className="section-label">{isSample ? "SAMPLE PRODUCT REPORT" : "PRODUCT REPORT"}</div>

          <div className="report-card">
            <div className="report-top">
              <div className="product-summary">
                {isSample ? (
                  <div className="sample-image" aria-label="Sample earbuds illustration">
                    <span />
                    <span />
                    <small>SAMPLE</small>
                  </div>
                ) : product.image_url ? (
                  <img className="product-image" src={product.image_url} alt="" />
                ) : (
                  <div className="product-image-fallback">P</div>
                )}

                <div className="product-details">
                  <div className="market-line">
                    <span className="shopee-mark">S</span>
                    SHOPEE PH · {isSample ? "Sample Store" : product.shop_name || "Shopee seller"}
                  </div>
                  <h2>{isSample ? "Wireless Bluetooth Earbuds with Charging Case" : product.name}</h2>

                  {isSample ? (
                    <div className="variation-line">Variation: Black · Public listed price</div>
                  ) : (
                    <div className="variation-control">
                      <label htmlFor="variation">Variation:</label>
                      <select
                        id="variation"
                        value={selectedVariationId ?? ""}
                        onChange={(event) => setSelectedVariationId(Number(event.target.value))}
                      >
                        {variations.map((variation) => (
                          <option key={variation.id} value={variation.id}>
                            {variation.name}
                          </option>
                        ))}
                      </select>
                      <span>· Public listed price</span>
                    </div>
                  )}

                  <div className="current-price-row">
                    <strong>{reportStats ? peso.format(reportStats.latest) : "—"}</strong>
                    {isSample && <span className="sample-badge">SAMPLE DATA</span>}
                  </div>
                  <p>{isSample ? "Example report until extension data arrives" : "Latest recorded observation for this variation"}</p>
                </div>
              </div>

              <div className="price-verdict">
                <span>{verdict.label}</span>
                <strong>{verdict.title}</strong>
                <p>{verdict.detail}</p>
                {!isSample && product && (
                  <a href={product.product_url} target="_blank" rel="noreferrer">View on Shopee ↗</a>
                )}
              </div>
            </div>

            <div className="stats-grid">
              <div>
                <span>LOWEST IN {range === "ALL" ? "HISTORY" : range}</span>
                <strong className="green-value">{reportStats ? peso.format(reportStats.low) : "—"}</strong>
                <small>Selected period</small>
              </div>
              <div>
                <span>HIGHEST IN {range === "ALL" ? "HISTORY" : range}</span>
                <strong>{reportStats ? peso.format(reportStats.high) : "—"}</strong>
                <small>Selected period</small>
              </div>
              <div>
                <span>AVERAGE PRICE</span>
                <strong>{reportStats ? peso.format(reportStats.average) : "—"}</strong>
                <small>{range === "ALL" ? "All recorded data" : `Last ${range.replace("D", "")} days`}</small>
              </div>
              <div>
                <span>OBSERVATIONS</span>
                <strong>{reportStats?.observations ?? 0}</strong>
                <small>Verified records</small>
              </div>
            </div>

            <div className="history-panel">
              <div className="history-heading">
                <div>
                  <h3>Price history</h3>
                  <p>Public listed price · {reportVariationName} variation</p>
                </div>
                <div className="range-tabs" aria-label="Price history range">
                  {(["7D", "30D", "90D", "ALL"] as RangeKey[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={range === item ? "active" : ""}
                      onClick={() => setRange(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              {chartData.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={chartData} margin={{ top: 18, right: 24, bottom: 8, left: 6 }}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e9eceb" />
                      <XAxis
                        dataKey="label"
                        tickMargin={12}
                        minTickGap={28}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#777887", fontSize: 12 }}
                      />
                      <YAxis
                        width={72}
                        domain={axisDomain}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `₱${Number(value).toLocaleString("en-PH")}`}
                        tick={{ fill: "#777887", fontSize: 12 }}
                      />
                      <Tooltip
                        formatter={(value) => [peso.format(Number(value)), reportVariationName]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ""}
                        contentStyle={{ borderRadius: 10, border: "1px solid #dddfea" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#13c89a"
                        strokeWidth={3}
                        dot={{ r: 3, fill: "#13c89a", strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: "#ffffff", stroke: "#13c89a", strokeWidth: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state">No observations for this variation in the selected range yet.</div>
              )}
            </div>
          </div>

          {!isSample && variations.length <= 1 && (
            <div className="legacy-note">
              This older record currently has only one saved “Default” variation. Once the updated extension
              submits Shopee model IDs, each variation will appear separately here.
            </div>
          )}
        </section>
      </main>

      <footer>
        <strong>PriceTrack PH</strong>
        <span>Independent historical price observations from public marketplace pages.</span>
      </footer>
    </div>
  );
}

export default App;
