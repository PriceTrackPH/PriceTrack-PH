import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { XAxisTickContentProps } from "recharts";
import type { Tables } from "./database.types";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import shopeeLogo from "./assets/shopee-logo.png";
import AdminHealth from "./AdminHealth";

type Product = Tables<"products">;
type Variation = Tables<"product_variations">;
type Observation = Tables<"price_observations">;
type RangeKey = "7D" | "30D" | "90D" | "ALL";

type ChartObservation = {
  price: number;
  timestamp: number;
  timeLabel: string;
};

type ChartPoint = {
  price: number;
  timestamp: number;
  label: string;
  fullDate: string;
  observations: ChartObservation[];
};

type OutboundLink = {
  url: string;
  isAffiliate: boolean;
};

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const MANILA_TIME_ZONE = "Asia/Manila";
const chartDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: MANILA_TIME_ZONE,
});
const chartDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: MANILA_TIME_ZONE,
});
const fullDateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: MANILA_TIME_ZONE,
});
const dayDateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: MANILA_TIME_ZONE,
});
const chartTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: MANILA_TIME_ZONE,
});

function chartDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  return chartDateKeyFormatter.format(date) === chartDateKeyFormatter.format(today)
    ? "Today"
    : chartDateFormatter.format(date);
}

function PriceHistoryXAxisTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  verticalAnchor,
}: XAxisTickContentProps) {
  const textAnchor = index === 0
    ? "start"
    : index === visibleTicksCount - 1
      ? "end"
      : "middle";

  return (
    <Text
      className="recharts-cartesian-axis-tick-value"
      x={x}
      y={y}
      fill="var(--report-muted)"
      fontSize={9}
      textAnchor={textAnchor}
      verticalAnchor={verticalAnchor}
    >
      {payload.value}
    </Text>
  );
}

function PriceHistoryTooltip({
  active,
  payload,
  variationName,
}: {
  active?: boolean;
  payload?: readonly { payload?: ChartPoint }[];
  variationName: string;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  const distinctPrices = new Set(point.observations.map((observation) => observation.price));
  const hasMultiplePrices = distinctPrices.size > 1;
  const singleTimeLabel = point.observations[0]?.timeLabel;

  return (
    <div className="recharts-default-tooltip daily-price-tooltip">
      <div className="daily-price-tooltip-date">
        {hasMultiplePrices || !singleTimeLabel
          ? point.fullDate
          : `${point.fullDate}, ${singleTimeLabel}`}
      </div>
      <div className="daily-price-tooltip-variation">
        {variationName} : {peso.format(point.price)}
      </div>
      {hasMultiplePrices && (
        <>
          <div className="daily-price-tooltip-divider" />
          <div className="daily-price-tooltip-observations">
            {point.observations.map((observation) => (
              <div
                key={`${observation.timestamp}-${observation.price}`}
                className="daily-price-tooltip-observation"
              >
                <span>{observation.timeLabel}</span>
                <span className="daily-price-tooltip-price">{peso.format(observation.price)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

async function resolveShopeeUrl(value: string) {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  const host = url.hostname.toLowerCase();

  if (/(^|\.)shopee\.ph$/i.test(host) && host !== "s.shopee.ph") {
    return parseShopeeUrl(trimmed);
  }

  if (host !== "s.shopee.ph" && host !== "ph.shp.ee") {
    throw new Error("Please paste a Shopee Philippines product link.");
  }

  const response = await fetch(`/api/resolve-shopee-link?url=${encodeURIComponent(trimmed)}`);
  const payload = await response.json().catch(() => ({})) as {
    shopId?: string;
    productId?: string;
    error?: string;
  };

  if (!response.ok || !payload.shopId || !payload.productId) {
    throw new Error(payload.error || "Could not resolve that Shopee short link.");
  }

  return { shopId: payload.shopId, productId: payload.productId };
}

async function resolveProductQuery(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return resolveShopeeUrl(trimmed);

  const response = await fetch(`/api/find-product-by-title?title=${encodeURIComponent(trimmed)}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as {
    shopId?: string;
    productId?: string;
    error?: string;
  };

  if (!response.ok || !payload.shopId || !payload.productId) {
    throw new Error(payload.error || "No exact product title match found in the PriceTrack database.");
  }

  return { shopId: payload.shopId, productId: payload.productId };
}

function latestObservation(rows: Observation[], variationId: number) {
  return rows
    .filter((row) => row.variation_id === variationId)
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function resolveOutboundLink(product: Product | null): OutboundLink | null {
  if (!product) return null;

  const metadata = product.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    const affiliateCandidates = [
      record.affiliate_url,
      record.affiliateUrl,
      record.affiliate_link,
      record.affiliateLink,
    ];

    if (record.affiliate && typeof record.affiliate === "object" && !Array.isArray(record.affiliate)) {
      const affiliate = record.affiliate as Record<string, unknown>;
      affiliateCandidates.push(affiliate.url, affiliate.href, affiliate.link);
    }

    for (const candidate of affiliateCandidates) {
      const url = safeHttpsUrl(candidate);
      if (url) return { url, isAffiliate: true };
    }
  }

  const directUrl = safeHttpsUrl(product.product_url);
  return directUrl ? { url: directUrl, isAffiliate: false } : null;
}

function countPriceChanges(points: ChartPoint[]) {
  let changes = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].price !== points[index - 1].price) changes += 1;
  }
  return changes;
}

function formatLastChecked(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return fullDateFormatter.format(new Date(timestamp));
}

function priceStep(maxPrice: number) {
  if (maxPrice < 20) return 5;
  if (maxPrice < 50) return 10;
  if (maxPrice < 100) return 20;
  if (maxPrice < 500) return 50;
  if (maxPrice < 1000) return 100;
  if (maxPrice < 2500) return 250;
  if (maxPrice < 5000) return 500;
  if (maxPrice < 10000) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(maxPrice));
  return magnitude;
}

function roundedAxis(points: ChartPoint[]) {
  if (!points.length) return { domain: [0, 100] as [number, number], ticks: [0, 20, 40, 60, 80, 100] };

  const prices = points.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  let step = priceStep(high);

  const calculateBounds = () => {
    const min = Math.max(0, Math.floor(low / step) * step - step);
    const max = Math.ceil(high / step) * step + step;
    return { min, max };
  };

  let bounds = calculateBounds();
  while ((bounds.max - bounds.min) / step + 1 > 7) {
    step *= 2;
    bounds = calculateBounds();
  }

  const ticks: number[] = [];
  for (let value = bounds.min; value <= bounds.max + step / 2; value += step) {
    ticks.push(value);
  }

  return { domain: [bounds.min, bounds.max] as [number, number], ticks };
}

function toRawChartPoints(rows: Observation[]) {
  return rows.map((row) => ({
    price: Number(row.price),
    timestamp: Date.parse(row.observed_at),
    label: chartDateLabel(row.observed_at),
    fullDate: fullDateFormatter.format(new Date(row.observed_at)),
    observations: [],
  }));
}

function toChartPoints(rows: Observation[]) {
  const grouped = new Map<string, Observation[]>();

  for (const row of rows) {
    const key = chartDateKeyFormatter.format(new Date(row.observed_at));
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  return Array.from(grouped.values())
    .map((dayRows) => {
      const sorted = [...dayRows].sort(
        (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
      );
      const lowest = sorted.reduce((best, row) => (
        Number(row.price) < Number(best.price) ? row : best
      ));

      return {
        price: Number(lowest.price),
        timestamp: Date.parse(lowest.observed_at),
        label: chartDateLabel(lowest.observed_at),
        fullDate: dayDateFormatter.format(new Date(lowest.observed_at)),
        observations: sorted.map((row) => ({
          price: Number(row.price),
          timestamp: Date.parse(row.observed_at),
          timeLabel: chartTimeFormatter.format(new Date(row.observed_at)),
        })),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function ReportApp() {
  const initialProductUrl = new URLSearchParams(window.location.search).get("url")?.trim() || "";
  const [query, setQuery] = useState(initialProductUrl);
  const [product, setProduct] = useState<Product | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<number | null>(null);
  const [variationMenuOpen, setVariationMenuOpen] = useState(false);
  const variationButtonRef = useRef<HTMLButtonElement | null>(null);
  const [variationPickerWidth, setVariationPickerWidth] = useState<number | undefined>(undefined);
  const [range, setRange] = useState<RangeKey>("30D");
  const [loading, setLoading] = useState(false);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProduct(shopId: string, productId: string, requireHistory = false) {
    if (!supabase) throw new Error("Supabase is not configured yet.");

    const { data: found, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("platform", "shopee")
      .eq("external_shop_id", shopId)
      .eq("external_product_id", productId)
      .maybeSingle();

    if (productError) throw productError;
    if (!found) throw new Error("This product isn't tracked yet. Install the PriceTrack PH extension and open this Shopee product to start recording future price changes.");

    const { data: models, error: variationError } = await supabase
      .from("product_variations")
      .select("*")
      .eq("product_id", found.id)
      .order("name");

    if (variationError) throw variationError;
    const allModelRows = models ?? [];
    const realModelRows = allModelRows.filter(
      (item) => String(item.external_variation_id ?? "").trim().toLowerCase() !== "default",
    );
    const modelRows = realModelRows.length ? realModelRows : allModelRows;
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

    if (requireHistory && (!modelRows.length || !history.length)) {
      throw new Error("Price recording is still being saved.");
    }

    const variationsWithLatest = modelRows
      .map((item) => ({ item, latest: latestObservation(history, item.id) }))
      .filter((entry) => entry.latest);

    const defaultVariation = variationsWithLatest
      .filter((entry) => entry.latest!.is_in_stock)
      .sort((a, b) => Number(a.latest!.price) - Number(b.latest!.price))[0]?.item
      ?? variationsWithLatest
        .sort((a, b) => Number(a.latest!.price) - Number(b.latest!.price))[0]?.item;

    setProduct(found);
    setVariations(modelRows);
    setObservations(history);
    setSelectedVariationId(defaultVariation?.id ?? modelRows[0]?.id ?? null);
    setVariationMenuOpen(false);
  }

  useEffect(() => {
    let active = true;

    async function loadInitialProduct() {
      if (!supabase) {
        setFeaturedLoading(false);
        return;
      }

      try {
        if (initialProductUrl) {
          const ids = await resolveShopeeUrl(initialProductUrl);
          let lastError: unknown;
          for (let attempt = 0; attempt < 10 && active; attempt += 1) {
            try {
              await loadProduct(ids.shopId, ids.productId, true);
              setQuery("");
              setHasSearched(true);
              return;
            } catch (cause) {
              lastError = cause;
              if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 1000));
            }
          }
          throw lastError;
        }

        const { data, error: featuredError } = await supabase
          .from("products")
          .select("external_shop_id,external_product_id")
          .eq("platform", "shopee")
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (featuredError) throw featuredError;
        if (data && active) {
          await loadProduct(data.external_shop_id, data.external_product_id);
        }
      } catch (cause) {
        console.error("Unable to load featured product", cause);
        if (initialProductUrl && active) {
          setHasSearched(true);
          setError(cause instanceof Error ? cause.message : "Unable to load this product.");
        }
      } finally {
        if (active) setFeaturedLoading(false);
      }
    }

    loadInitialProduct();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const ids = await resolveProductQuery(query);
      await loadProduct(ids.shopId, ids.productId);
      setHasSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this product.");
    } finally {
      setLoading(false);
    }
  }

  const selectedVariation = variations.find((item) => item.id === selectedVariationId) ?? null;

  const latestByVariationId = useMemo(() => {
    const latest = new Map<number, Observation>();
    for (const row of observations) latest.set(row.variation_id, row);
    return latest;
  }, [observations]);

  const selectedLatestObservation = selectedVariationId == null
    ? null
    : latestByVariationId.get(selectedVariationId) ?? null;
  const selectedIsOutOfStock = selectedLatestObservation?.is_in_stock === false;

  const allVariationRows = useMemo(() => {
    if (selectedVariationId == null) return [];
    return observations.filter((row) => row.variation_id === selectedVariationId);
  }, [observations, selectedVariationId]);

  const selectedHistory = useMemo(() => {
    const now = Date.now();
    const days = range === "ALL" ? null : Number(range.replace("D", ""));
    return allVariationRows.filter((row) => (
      days == null || Date.parse(row.observed_at) >= now - days * 86_400_000
    ));
  }, [allVariationRows, range]);

  const chartData = useMemo(() => toChartPoints(selectedHistory), [selectedHistory]);
  const allVariationPoints = useMemo(() => toRawChartPoints(allVariationRows), [allVariationRows]);
  const reportVariationName = selectedVariation?.name ?? "Default";
  const hasMultipleVariations = variations.length > 1;

  useLayoutEffect(() => {
    const button = variationButtonRef.current;
    if (!button || !variations.length) {
      setVariationPickerWidth(undefined);
      return;
    }

    let cancelled = false;

    const measureLongestVariation = () => {
      if (cancelled || !variationButtonRef.current) return;

      const currentButton = variationButtonRef.current;
      const styles = window.getComputedStyle(currentButton);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;

      context.font = [
        styles.fontStyle,
        styles.fontVariant,
        styles.fontWeight,
        styles.fontSize,
        styles.fontFamily,
      ].join(" ");

      const letterSpacing = styles.letterSpacing === "normal"
        ? 0
        : Number.parseFloat(styles.letterSpacing) || 0;

      const longestTextWidth = variations.reduce((longest, variation) => {
        const latest = latestByVariationId.get(variation.id);
        const suffix = latest?.is_in_stock === false ? " — Out of stock" : "";
        const label = `${variation.name}${suffix}`;
        const measured = context.measureText(label).width
          + Math.max(0, label.length - 1) * letterSpacing;
        return Math.max(longest, measured);
      }, 0);

      const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0)
        + (Number.parseFloat(styles.paddingRight) || 0);
      const horizontalBorders = (Number.parseFloat(styles.borderLeftWidth) || 0)
        + (Number.parseFloat(styles.borderRightWidth) || 0);
      const measuredWidth = Math.ceil(longestTextWidth + horizontalPadding + horizontalBorders);

      setVariationPickerWidth(Math.min(430, measuredWidth));
    };

    measureLongestVariation();
    void document.fonts.ready.then(measureLongestVariation);

    return () => {
      cancelled = true;
    };
  }, [variations, latestByVariationId]);

  const outboundLink = resolveOutboundLink(product);
  const priceChanges = countPriceChanges(allVariationPoints);
  const lastCheckedLabel = formatLastChecked(product?.last_seen_at);
  const axis = useMemo(() => roundedAxis(chartData), [chartData]);

  const reportStats = useMemo(() => {
    if (!selectedHistory.length) return null;
    const prices = selectedHistory.map((row) => Number(row.price));
    const latest = Number(selectedHistory[selectedHistory.length - 1].price);
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
  }, [selectedHistory]);

  const verdict = useMemo(() => {
    if (selectedLatestObservation?.is_in_stock === false) {
      return {
        label: "OUT OF STOCK",
        title: "Currently unavailable",
        detail: `Last listed price: ${peso.format(Number(selectedLatestObservation.price))}.`,
      };
    }
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
  }, [reportStats, selectedLatestObservation]);

  const displayedPrice = selectedLatestObservation
    ? peso.format(Number(selectedLatestObservation.price))
    : reportStats
      ? peso.format(reportStats.latest)
      : "—";

  return (
    <div className="app-shell" id="top">
      <main>
        <section className="hero-band">
          <div className="hero-inner">
            <div className="eyebrow">— &nbsp; INDEPENDENT PRICE TRACKER</div>
            <h1>
              Know if the sale<br />
              is <em>really</em> a sale.
            </h1>
            <p>
              Paste any supported product link to see today&apos;s price, its recorded low and high, and
              how the price changed over time.
            </p>

            <form className="search-box" onSubmit={handleSubmit}>
              <span className="link-mark">🔗</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Paste a product link..."
                aria-label="Marketplace product link"
              />
              <button disabled={loading || !query.trim()}>
                {loading ? "Checking…" : "Check price"}
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </form>

            {hasSearched && (
              <div className="found-status" role="status">
                Found {priceChanges} price change{priceChanges === 1 ? "" : "s"}.
              </div>
            )}

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
          <div className="section-label">DATABASE PRODUCT REPORT</div>

          {featuredLoading && !product ? (
            <div className="report-loading">Loading a recently tracked product…</div>
          ) : product ? (
            <div className="report-card">
              <div className="report-top">
                <div className="product-summary">
                  {product.image_url ? (
                    <img className="product-image" src={product.image_url} alt="" />
                  ) : (
                    <div className="product-image-fallback">P</div>
                  )}

                  <div className="product-details">
                    <div className="market-line">
                      <img className="shopee-mark" src={shopeeLogo} alt="Shopee" />
                      SHOPEE PH
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          margin: "0 7px",
                          borderRadius: "50%",
                          background: "#13c89a",
                          verticalAlign: "middle",
                          flex: "0 0 auto",
                        }}
                      />
                      {product.shop_name || "Shopee seller"}
                    </div>
                    <h2>{product.name}</h2>

                    {hasMultipleVariations ? (
                      <div className="variation-control">
                        <span className="variation-label">Variation:</span>
                        <div
                          className={`variation-picker${variationMenuOpen ? " open" : ""}`}
                          style={{ width: variationPickerWidth }}
                          onBlur={(event) => {
                            const nextTarget = event.relatedTarget;
                            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                              setVariationMenuOpen(false);
                            }
                          }}
                        >
                          <button
                            ref={variationButtonRef}
                            type="button"
                            className="variation-picker-button"
                            aria-haspopup="listbox"
                            aria-expanded={variationMenuOpen}
                            onClick={() => setVariationMenuOpen((open) => !open)}
                          >
                            <span>
                              {selectedVariation?.name ?? "Choose variation"}
                              {selectedIsOutOfStock ? " — Out of stock" : ""}
                            </span>
                            <span className="variation-chevron" aria-hidden="true">⌄</span>
                          </button>

                          {variationMenuOpen && (
                            <div className="variation-menu" role="listbox" aria-label="Product variation">
                              {variations.map((variation) => {
                                const latest = latestByVariationId.get(variation.id);
                                const unavailable = latest?.is_in_stock === false;
                                const selected = variation.id === selectedVariationId;
                                return (
                                  <button
                                    key={variation.id}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className={`variation-option${selected ? " selected" : ""}`}
                                    onClick={() => {
                                      setSelectedVariationId(variation.id);
                                      setVariationMenuOpen(false);
                                    }}
                                  >
                                    <span className="variation-option-name">{variation.name}</span>
                                    {unavailable && <small>Out of stock</small>}
                                    {selected && <span className="variation-check" aria-hidden="true">✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <span>· Public listed price</span>
                      </div>
                    ) : (
                      <div className="variation-control single-listing-price">
                        <span>Public listed price</span>
                      </div>
                    )}

                    <div className="current-price-row">
                      <strong>{displayedPrice}</strong>
                      <span className={`sample-badge live-badge${selectedIsOutOfStock ? " out-of-stock-badge" : ""}`}>
                        {selectedIsOutOfStock ? "OUT OF STOCK" : "LIVE DATABASE"}
                      </span>
                    </div>
                    <p>
                      {priceChanges} recorded price change{priceChanges === 1 ? "" : "s"}
                      {lastCheckedLabel ? ` · Last checked ${lastCheckedLabel}` : ""}
                    </p>
                  </div>
                </div>

                <div className={`price-verdict${selectedIsOutOfStock ? " out-of-stock" : ""}`}>
                  <span>{verdict.label}</span>
                  <strong>{verdict.title}</strong>
                  <p>{verdict.detail}</p>
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
                    <p>
                      Public listed price · {hasMultipleVariations ? `${reportVariationName} variation` : "Single listing"}
                      {selectedIsOutOfStock ? " · Currently out of stock" : ""}
                    </p>
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
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart
                        accessibilityLayer={false}
                        data={chartData}
                        margin={{ top: 18, right: 24, bottom: 8, left: 6 }}
                      >
                        <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e9eceb" />
                        <XAxis
                          dataKey="label"
                          tickMargin={12}
                          minTickGap={28}
                          interval="preserveStartEnd"
                          axisLine={false}
                          tickLine={false}
                          tick={(props) => (
                            <PriceHistoryXAxisTick {...(props as XAxisTickContentProps)} />
                          )}
                        />
                        <YAxis
                          width={72}
                          domain={axis.domain}
                          ticks={axis.ticks}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => `₱${Number(value).toLocaleString("en-PH")}`}
                          tick={{ fill: "#777887", fontSize: 12 }}
                        />
                        <Tooltip
                          cursor={false}
                          content={(props) => (
                            <PriceHistoryTooltip
                              active={props.active}
                              payload={props.payload as readonly { payload?: ChartPoint }[] | undefined}
                              variationName={reportVariationName}
                            />
                          )}
                        />
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke="#13c89a"
                          strokeWidth={3}
                          fill="#13c89a"
                          fillOpacity={0.14}
                          dot={{ r: 3, fill: "#ffffff", stroke: "#13c89a", strokeWidth: 2 }}
                          activeDot={{ r: 5, fill: "#ffffff", stroke: "#13c89a", strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-state">No observations for this variation in the selected range yet.</div>
                )}

                <div className="report-actions-wrap">
                  <div className="report-actions">
                    <a className="track-price-button" href="#extension">☆ Track price</a>
                    {outboundLink && (
                      <a
                        className="shopee-outbound-button"
                        href={outboundLink.url}
                        target="_blank"
                        rel={outboundLink.isAffiliate ? "sponsored noopener noreferrer" : "noopener noreferrer"}
                      >
                        View on Shopee ↗
                      </a>
                    )}
                  </div>
                  <p className={outboundLink?.isAffiliate ? "outbound-disclosure affiliate" : "outbound-disclosure"}>
                    {outboundLink?.isAffiliate
                      ? "Affiliate link — PriceTrack PH may earn a commission at no extra cost to you."
                      : "No hidden redirects. Direct Shopee link; affiliate links are clearly labeled before you click."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="report-loading">No tracked products are available yet.</div>
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

function App() {
  const pathname = window.location.pathname;
  return pathname === "/admin/health" || pathname === "/admin/health/"
    ? <AdminHealth />
    : <ReportApp />;
}

export default App;
