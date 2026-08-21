import { FormEvent, useEffect, useMemo, useState } from "react";
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

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

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
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("30D");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("products")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(6)
      .then(({ data }) => setRecentProducts(data ?? []));
  }, []);

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

  async function openRecent(item: Product) {
    setQuery(item.product_url);
    setLoading(true);
    setError(null);
    try {
      await loadProduct(item.external_shop_id, item.external_product_id);
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

  const stats = useMemo(() => {
    if (!selectedHistory.length) return null;
    const prices = selectedHistory.map((row) => Number(row.price));
    let changes = 0;
    for (let index = 1; index < prices.length; index += 1) {
      if (prices[index] !== prices[index - 1]) changes += 1;
    }
    return {
      latest: prices[prices.length - 1],
      low: Math.min(...prices),
      high: Math.max(...prices),
      changes,
    };
  }, [selectedHistory]);

  const chartData = selectedHistory.map((row) => ({
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">P</div>
        <div>
          <strong>PriceTrack PH</strong>
          <span>Shopee Beta</span>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow">PRICE HISTORY, BY VARIATION</div>
          <h1>Check what a Shopee product really costs over time.</h1>
          <p>
            Paste a Shopee Philippines product link. The chart keeps each variation separate so different
            models are never mistaken for one product changing price.
          </p>

          <form className="search-box" onSubmit={handleSubmit}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste a Shopee product link"
              aria-label="Shopee product link"
            />
            <button disabled={loading || !query.trim()}>{loading ? "Checking…" : "Check price"}</button>
          </form>

          {!hasSupabaseConfig && (
            <div className="notice">
              Local setup needed: copy <code>.env.example</code> to <code>.env.local</code> and add the
              Supabase publishable key.
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </section>

        {product ? (
          <section className="report card">
            <div className="product-row">
              {product.image_url ? <img src={product.image_url} alt="" /> : <div className="image-fallback">P</div>}
              <div className="product-copy">
                <div className="platform-pill">{product.platform}</div>
                <h2>{product.name}</h2>
                <p>{product.shop_name || "Shopee seller"}</p>
              </div>
              <a href={product.product_url} target="_blank" rel="noreferrer">View product ↗</a>
            </div>

            <div className="controls-row">
              <label>
                <span>Variation</span>
                <select
                  value={selectedVariationId ?? ""}
                  onChange={(event) => setSelectedVariationId(Number(event.target.value))}
                >
                  {variations.map((variation) => (
                    <option key={variation.id} value={variation.id}>
                      {variation.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="range-tabs" aria-label="Price history range">
                {(["7D", "30D", "90D", "ALL"] as RangeKey[]).map((item) => (
                  <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <p className="variation-note">
              The extension records all detected variations automatically. This selector only chooses which
              variation's history you want to view.
            </p>

            {stats ? (
              <>
                <div className="stats-grid">
                  <div><span>Latest</span><strong>{peso.format(stats.latest)}</strong></div>
                  <div><span>Lowest</span><strong>{peso.format(stats.low)}</strong></div>
                  <div><span>Highest</span><strong>{peso.format(stats.high)}</strong></div>
                  <div><span>Price changes</span><strong>{stats.changes}</strong></div>
                </div>

                <div className="chart-wrap">
                  <div className="chart-heading">
                    <div>
                      <span>Price history</span>
                      <strong>{selectedVariation?.name ?? "Variation"}</strong>
                    </div>
                    <span>{selectedHistory.length} observation{selectedHistory.length === 1 ? "" : "s"}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={330}>
                    <LineChart data={chartData} margin={{ top: 16, right: 18, bottom: 8, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tickMargin={10} minTickGap={24} />
                      <YAxis
                        width={74}
                        domain={["auto", "auto"]}
                        tickFormatter={(value) => `₱${Number(value).toLocaleString("en-PH")}`}
                      />
                      <Tooltip
                        formatter={(value) => [peso.format(Number(value)), selectedVariation?.name ?? "Price"]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ""}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#ee4d2d"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <div className="empty-state">No observations for this variation in the selected range yet.</div>
            )}
          </section>
        ) : (
          recentProducts.length > 0 && (
            <section className="recent-section">
              <div className="section-heading">
                <div>
                  <span>RECENTLY RECORDED</span>
                  <h2>Products already in PriceTrack</h2>
                </div>
              </div>
              <div className="recent-grid">
                {recentProducts.map((item) => (
                  <button key={item.id} className="recent-card" onClick={() => openRecent(item)}>
                    {item.image_url ? <img src={item.image_url} alt="" /> : <div className="mini-fallback">P</div>}
                    <span>{item.shop_name || "Shopee"}</span>
                    <strong>{item.name}</strong>
                  </button>
                ))}
              </div>
            </section>
          )
        )}
      </main>

      <footer>
        <strong>PriceTrack PH</strong>
        <span>Historical prices are observations collected by the browser extension.</span>
      </footer>
    </div>
  );
}

export default App;
