import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import "./watchlist.css";

type SavedProduct = { id: string | number; name: string; image_url: string | null; external_shop_id: string; external_product_id: string; added_at: string };
type PriceInfo = { price: number; checked: string; previous: number | null };
const STORAGE_KEY = "pricetrack-watchlist-v1";
function ProductTitle({ name }: { name: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const heading = ref.current;
    if (!heading) return;
    const fit = () => {
      heading.style.webkitLineClamp = "unset";
      for (let size = 16; size >= 12; size--) {
        heading.style.fontSize = `${size}px`;
        if (heading.scrollHeight <= size * 1.35 * 3 + 1) break;
      }
      heading.style.webkitLineClamp = "3";
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (heading.parentElement) observer.observe(heading.parentElement);
    return () => observer.disconnect();
  }, [name]);
  return <h2 ref={ref} title={name}>{name}</h2>;
}
function readSaved(): SavedProduct[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data.filter((p): p is SavedProduct => !!p && typeof p === "object" && typeof p.external_shop_id === "string" && typeof p.external_product_id === "string") : [];
  } catch { return []; }
}
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
export default function Watchlist() {
  const [saved, setSaved] = useState(readSaved);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  useEffect(() => {
    const sync = () => {
      const next = readSaved();
      setSaved(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setSelected(ids => ids.filter(id => next.some(p => String(p.id) === id)));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) sync();
    };
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pricetrack-watchlist-changed", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    sync();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pricetrack-watchlist-changed", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      const client = supabase;
      if (!client) return;
      const next: Record<string, PriceInfo> = {};
      await Promise.all(saved.map(async (p) => {
        const { data: variations, error: variationError } = await client.from("product_variations").select("id,name,external_variation_id").eq("product_id", Number(p.id)).order("name");
        if (variationError) return;
        const all = variations || [];
        const real = all.filter(v => String(v.external_variation_id ?? "").trim().toLowerCase() !== "default");
        const models = real.length ? real : all;
        if (!models.length) return;
        const { data, error } = await client.from("price_observations").select("price,observed_at,variation_id,is_in_stock").in("variation_id", models.map(v => v.id)).order("observed_at", { ascending: false });
        if (error || !data?.length) return;
        const candidates = models.map(model => ({ model, latest: data.find(row => row.variation_id === model.id) })).filter(entry => entry.latest);
        const available = candidates.filter(entry => entry.latest!.is_in_stock);
        const chosen = (available.length ? available : candidates).sort((a,b) => Number(a.latest!.price) - Number(b.latest!.price))[0];
        if (!chosen?.latest) return;
        const latest = chosen.latest;
        const previous = data.find(row => row.variation_id === latest.variation_id && row.observed_at < latest.observed_at);
        next[String(p.id)] = { price: Number(latest.price), checked: latest.observed_at, previous: previous ? Number(previous.price) : null };

      }));
      if (active) setPrices(next);
    }
    if (saved.length) void load();
    return () => { active = false; };
  }, [saved]);
  const shown = useMemo(() => saved.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).sort((a,b) => sort === "name" ? a.name.localeCompare(b.name) : Date.parse(b.added_at) - Date.parse(a.added_at)), [saved, search, sort]);
  const remove = (id: SavedProduct["id"]) => {
    const next = saved.filter(p => String(p.id) !== String(id));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setSelected(ids => ids.filter(value => value !== String(id))); } catch { window.alert("Could not update browser storage."); }
  };
  const deleteSelected = () => {
    if (!selected.length || !window.confirm(`Remove ${selected.length} selected product${selected.length === 1 ? "" : "s"} from your Watchlist?`)) return;
    const next = saved.filter(p => !selected.includes(String(p.id)));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setSelected([]); setSelecting(false); } catch { window.alert("Could not update browser storage."); }
  };
  const clear = () => {
    if (!window.confirm("Remove all products from your Watchlist?")) return;
    try { localStorage.setItem(STORAGE_KEY, "[]"); setSaved([]); setSelected([]); setSelecting(false); } catch { window.alert("Could not update browser storage."); }
  };
  return <main className="watchlist-background">
    <header className="watchlist-heading"><span className="watchlist-kicker">SAVED PRODUCTS</span><h1>Your Watchlist</h1><p>Keep your saved products together and follow their recorded prices.</p><div className="watchlist-heading-notes"><p>Prices show the latest recorded observations. The percentage compares the displayed variation’s latest price with its previous recorded price.</p><p><strong>Saved in this browser only.</strong> Your list stays after closing or restarting the browser, but does not automatically sync to another browser or device. Clearing this site’s data or deleting your browser profile erases it. Uninstalling the browser may also erase it if its data is removed. In private browsing, the list is usually lost when the private session closes.</p></div></header>
    <div className="watchlist-page">
    <div className="watchlist-top">
      <div className="watchlist-tools">
        <input aria-label="Search in your watchlist" placeholder="Search in your watchlist..." value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Sort Watchlist" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently Added</option><option value="name">Product Name</option></select>
        {saved.length > 0 && <button className="watchlist-clear" onClick={clear}>Clear All</button>}
        {saved.length > 0 && <button type="button" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? "Cancel Selection" : "Select Products"}</button>}
        {selected.length > 0 && <button type="button" className="watchlist-clear" onClick={deleteSelected}>Delete Selected ({selected.length})</button>}
      </div>
    </div>
    <details className="watchlist-guide"><summary>How to use your Watchlist</summary><div><p>Open a product’s price history and choose <strong>Add to Watchlist</strong>. Return here to search, sort, view price history, or remove saved products. Use <strong>Select Products</strong> to remove several at once.</p></div></details>
    {saved.length === 0 ? <div className="watchlist-empty"><h2>Your Watchlist is empty</h2><p>Find products and select Add to Watchlist to save them here.</p><a href="/">Search Products</a></div> :
      shown.length === 0 ? <div className="watchlist-empty"><p>No saved products match your search.</p></div> :
      <div className="watchlist-grid">{shown.map(p => {
        const price = prices[String(p.id)];
        const change = price && price.previous !== null && price.previous > 0 ? (price.price - price.previous) / price.previous * 100 : null;
        return <article className="watchlist-card" key={String(p.id)}>
          {selecting && <label className="watchlist-select"><input type="checkbox" checked={selected.includes(String(p.id))} onChange={e => setSelected(ids => e.target.checked ? [...ids, String(p.id)] : ids.filter(id => id !== String(p.id)))} aria-label={`Select ${p.name}`} />Select product</label>}
          <div className="watchlist-card-body">
            {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <div className="watchlist-no-image">No image</div>}
            <div className="watchlist-details"><ProductTitle name={p.name} /><div className="watchlist-price-row"><strong>{price ? money.format(price.price) : "Price unavailable"}</strong>{price && <><span className={`watchlist-price-change ${change === null || change === 0 ? "unchanged" : change < 0 ? "down" : "up"}`} title="Compared with the previous recorded price of the same variation">{change === null ? "—" : `${change < 0 ? "↓ " : change > 0 ? "↑ " : ""}${Math.abs(change).toLocaleString("en-PH", {maximumFractionDigits: 1})}%`}</span></>}</div><small>{price ? "Last checked: " + new Date(price.checked).toLocaleString("en-PH", {timeZone:"Asia/Manila"}) : "Open price history for latest details"}</small></div>
          </div>
          <div className="watchlist-card-actions"><a href={`/product/shopee/${p.external_shop_id}/${p.external_product_id}`}>View Price History</a><button onClick={() => remove(p.id)}>Remove</button></div>
        </article>;
      })}</div>}
  </div></main>;
}
