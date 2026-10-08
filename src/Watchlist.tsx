import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import "./watchlist.css";

type SavedProduct = { id: string | number; name: string; image_url: string | null; external_shop_id: string; external_product_id: string; added_at: string };
type PriceInfo = { price: number; checked: string; previous: number | null };
const STORAGE_KEY = "pricetrack-watchlist-v1";
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
        const { data: variations } = await client.from("product_variations").select("id").eq("product_id", Number(p.id)).limit(30);
        const ids = variations?.map(v => v.id) || [];
        if (!ids.length) return;
        const { data } = await client.from("price_observations").select("price,observed_at").in("variation_id", ids).order("observed_at", { ascending: false }).limit(100);
        if (!data?.length) return;
        const latest = data[0];
        next[String(p.id)] = { price: Number(latest.price), checked: latest.observed_at, previous: data.length > 1 ? Number(data[1].price) : null };
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
  return <main className="watchlist-background"><div className="watchlist-page">
    <div className="watchlist-top">
      <div><h1>Watchlist</h1><p>Products you saved. Prices reflect the latest available recorded observations.</p></div>
      <div className="watchlist-tools">
        <input aria-label="Search in your watchlist" placeholder="Search in your watchlist..." value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Sort Watchlist" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently Added</option><option value="name">Product Name</option></select>
        {saved.length > 0 && <button className="watchlist-clear" onClick={clear}>Clear All</button>}
        {saved.length > 0 && <button type="button" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? "Cancel Selection" : "Select Products"}</button>}
        {selected.length > 0 && <button type="button" className="watchlist-clear" onClick={deleteSelected}>Delete Selected ({selected.length})</button>}
      </div>
    </div>
    {saved.length === 0 ? <div className="watchlist-empty"><h2>Your Watchlist is empty</h2><p>Find products and select Add to Watchlist to save them here.</p><a href="/">Search Products</a></div> :
      shown.length === 0 ? <div className="watchlist-empty"><p>No saved products match your search.</p></div> :
      <div className="watchlist-grid">{shown.map(p => {
        const price = prices[String(p.id)];
        return <article className="watchlist-card" key={String(p.id)}>
          {selecting && <label className="watchlist-select"><input type="checkbox" checked={selected.includes(String(p.id))} onChange={e => setSelected(ids => e.target.checked ? [...ids, String(p.id)] : ids.filter(id => id !== String(p.id)))} aria-label={`Select ${p.name}`} />Select product</label>}
          <div className="watchlist-card-body">
            {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <div className="watchlist-no-image">No image</div>}
            <div className="watchlist-details"><h2>{p.name}</h2><strong>{price ? money.format(price.price) : "Price unavailable"}</strong><small>{price ? "Last checked: " + new Date(price.checked).toLocaleString("en-PH", {timeZone:"Asia/Manila"}) : "Open price history for latest details"}</small></div>
          </div>
          <div className="watchlist-card-actions"><a href={`/product/shopee/${p.external_shop_id}/${p.external_product_id}`}>View Price History</a><button onClick={() => remove(p.id)}>Remove</button></div>
        </article>;
      })}</div>}
  </div></main>;
}
