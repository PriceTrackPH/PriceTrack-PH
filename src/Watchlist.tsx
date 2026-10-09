import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import "./watchlist.css";

type SavedProduct = { id: string | number; name: string; image_url: string | null; external_shop_id: string; external_product_id: string; added_at: string };
type PriceInfo = { price: number; checked: string; previous: number | null };
const STORAGE_KEY = "pricetrack-watchlist-v1";
const SORT_KEY = "pricetrack-watchlist-sort";
function readSort() {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return value && ["recent", "name", "price-low", "price-high", "drop", "rise"].includes(value) ? value : "recent";
  } catch { return "recent"; }
}
function ProductTitle({ name }: { name: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const heading = ref.current;
    if (!heading) return;
    const fit = () => {
      heading.style.webkitLineClamp = "unset";
      for (let size = window.matchMedia("(max-width:650px)").matches ? 14 : 16; size >= 12; size--) {
        heading.style.fontSize = `${size}px`;
        const mobile = window.matchMedia("(max-width:650px)").matches;
        if (heading.scrollHeight <= (mobile ? 36 : size * 1.35 * 3) + 1) break;
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
function formatChange(change: number) {
  const magnitude = Math.abs(change);
  if (magnitude > 0 && magnitude < 0.01) return "<0.01";
  return magnitude.toLocaleString("en-PH", { maximumFractionDigits: magnitude > 0 && magnitude < 0.1 ? 2 : 1 });
}
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
export default function Watchlist() {
  const [saved, setSaved] = useState(readSaved);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(readSort);
  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* Keep sorting usable if browser storage is unavailable. */ }
  }, [sort]);
  const [page, setPage] = useState(1);
  const productsTop = useRef<HTMLDivElement>(null);
  const changePage = (nextPage: number) => {
    setPage(nextPage);
    productsTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const importInput = useRef<HTMLInputElement>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const exportWatchlist = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    const stamp = `${part("year")}-${part("month")}-${part("day")}_${part("hour")}-${part("minute")}-${part("second")}`;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, products: saved }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pricetrack-watchlist-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage(`Exported ${saved.length} products.`);
  };
  const importWatchlist = async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Please use a backup smaller than 5 MB.");
      const data = JSON.parse(await file.text());
      if (!data || data.version !== 1 || !Array.isArray(data.products)) throw new Error("This is not a supported Watchlist backup.");
      const imported: SavedProduct[] = data.products.map((p: SavedProduct) => {
        if (!p || !/^\d+$/.test(String(p.id)) || Number(p.id) <= 0 || typeof p.name !== "string" || !p.name.trim() || typeof p.external_shop_id !== "string" || !/^\d+$/.test(p.external_shop_id) || typeof p.external_product_id !== "string" || !/^\d+$/.test(p.external_product_id) || typeof p.added_at !== "string" || !Number.isFinite(Date.parse(p.added_at)) || !(p.image_url === null || (typeof p.image_url === "string" && /^https?:\/\//i.test(p.image_url)))) throw new Error("The backup contains invalid product details. Nothing was imported.");
        return { id: p.id, name: p.name, image_url: p.image_url, external_shop_id: p.external_shop_id, external_product_id: p.external_product_id, added_at: p.added_at };
      });
      const next = readSaved();
      const keys = new Set(next.map(p => `${p.external_shop_id}/${p.external_product_id}`));
      const ids = new Set(next.map(p => String(p.id)));
      let added = 0;
      for (const product of imported) {
        const key = `${product.external_shop_id}/${product.external_product_id}`;
        if (keys.has(key) || ids.has(String(product.id))) continue;
        next.push(product); keys.add(key); ids.add(String(product.id)); added++;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaved(next);
      window.dispatchEvent(new Event("pricetrack-watchlist-changed"));
      setBackupMessage(`Imported ${added} products. Skipped ${imported.length - added} duplicates.`);
    } catch (error) {
      setBackupMessage(error instanceof SyntaxError ? "Could not read this JSON backup. Nothing was imported." : error instanceof Error ? error.message : "Could not import the Watchlist backup.");
    }
  };
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
  const shown = useMemo(() => {
    const changeFor = (p: SavedProduct) => {
      const info = prices[String(p.id)];
      return info && info.previous !== null && info.previous > 0 ? (info.price - info.previous) / info.previous * 100 : null;
    };
    return saved.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
      const recent = Date.parse(b.added_at) - Date.parse(a.added_at);
      if (sort === "name") return a.name.localeCompare(b.name) || recent;
      if (sort === "price-low" || sort === "price-high") {
        const ap = prices[String(a.id)]?.price, bp = prices[String(b.id)]?.price;
        if (ap === undefined || bp === undefined) return Number(ap === undefined) - Number(bp === undefined) || recent;
        return (sort === "price-low" ? ap - bp : bp - ap) || recent;
      }
      const ac = changeFor(a), bc = changeFor(b);
      if (sort === "drop" || sort === "rise") {
        if (ac === null || bc === null) return Number(ac === null) - Number(bc === null) || recent;
        return (sort === "drop" ? ac - bc : bc - ac) || recent;
      }
      return recent;
    });
  }, [saved, search, sort, prices]);
  const totalPages = Math.max(1, Math.ceil(shown.length / 15));
  const currentPage = Math.min(page, totalPages);
  const pageProducts = shown.slice((currentPage - 1) * 15, currentPage * 15);
  useEffect(() => { setPage(1); }, [search, sort]);
  useEffect(() => { setPage(value => Math.min(value, totalPages)); }, [totalPages]);
  const remove = (id: SavedProduct["id"]) => {
    const next = saved.filter(p => String(p.id) !== String(id));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setSelected(ids => ids.filter(value => value !== String(id))); } catch { window.alert("Could not update browser storage."); }
  };
  const deleteSelected = () => {
    if (!selected.length || !window.confirm(`Remove ${selected.length} selected product${selected.length === 1 ? "" : "s"} from your Watchlist?`)) return;
    const next = saved.filter(p => !selected.includes(String(p.id)));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setSelected([]); setSelecting(false); } catch { window.alert("Could not update browser storage."); }
  };
  return <main className="watchlist-background">
    <header className="watchlist-heading"><span className="watchlist-kicker">SAVED PRODUCTS</span><h1>Your Watchlist</h1><p>Keep your saved products together and follow their recorded prices. Prices show the latest recorded observations. The percentage compares the displayed variation’s latest price with its previous recorded price.</p><div className="watchlist-heading-notes"><p><strong>Saved in this browser only.</strong> Your list stays after closing or restarting the browser, but does not automatically sync to another browser or device. Clearing this site’s data or deleting your browser profile erases it. Uninstalling the browser may also erase it if its data is removed. In private browsing, the list is usually lost when the private session closes. Use <strong>Export</strong> to download a backup and <strong>Import</strong> to restore it here or in another browser. Import keeps existing products and skips duplicates.</p></div></header>
    <div className="watchlist-page" ref={productsTop}>
    <div className="watchlist-top">
      <div className="watchlist-tools">
        <input aria-label="Search in your watchlist" placeholder="Search in your watchlist..." value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Sort Watchlist" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently Added</option><option value="name">Product Name</option><option value="price-low">Price: Low to High</option><option value="price-high">Price: High to Low</option><option value="drop">Biggest Price Drop</option><option value="rise">Biggest Price Increase</option></select>
        <div className="watchlist-selection-tools">
        {selected.length > 0 && <button type="button" className="watchlist-clear" onClick={deleteSelected}>Delete Selected ({selected.length})</button>}
        {selecting && <>
          <button type="button" aria-label="Select products on this page" disabled={!pageProducts.length} onClick={() => setSelected(pageProducts.map(p => String(p.id)))}>This Page</button>
          <button type="button" aria-label="Select all saved products" title="All Products" onClick={() => setSelected(saved.map(p => String(p.id)))}>All Products</button>
        </>}
        {saved.length > 0 && <button type="button" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? "Cancel" : "Select"}</button>}
        </div>
        <button className="watchlist-export" type="button" onClick={exportWatchlist} disabled={!saved.length}>Export</button>
        <button className="watchlist-import" type="button" onClick={() => importInput.current?.click()}>Import</button>
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importWatchlist(file); }} />
      </div>
    </div>
    {backupMessage && <p className="watchlist-backup-message" role="status">{backupMessage}</p>}
    {saved.length === 0 ? <div className="watchlist-empty"><h2>Your Watchlist is empty</h2><p>Find products and select Add to Watchlist to save them here.</p><a href="/">Search Products</a></div> :
      shown.length === 0 ? <div className="watchlist-empty"><p>No saved products match your search.</p></div> :
      <div className="watchlist-grid">{pageProducts.map(p => {
        const price = prices[String(p.id)];
        const change = price && price.previous !== null && price.previous > 0 ? (price.price - price.previous) / price.previous * 100 : null;
        return <article className="watchlist-card" key={String(p.id)}>
          <div className="watchlist-card-body">
            <label className={`watchlist-image${selecting ? " is-selectable" : ""}${selecting && selected.includes(String(p.id)) ? " is-selected" : ""}`}>
            {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <div className="watchlist-no-image">No image</div>}
          {selecting && <input className="watchlist-image-checkbox" type="checkbox" checked={selected.includes(String(p.id))} onChange={e => setSelected(ids => e.target.checked ? [...ids, String(p.id)] : ids.filter(id => id !== String(p.id)))} aria-label={`Select ${p.name}`} />}
            </label>
            <div className="watchlist-details"><ProductTitle name={p.name} /><div className="watchlist-price-row"><strong>{price ? money.format(price.price) : "Price unavailable"}</strong>{price && <><span className={`watchlist-price-change ${change === null || change === 0 ? "unchanged" : change < 0 ? "down" : "up"}`} title="Compared with the previous recorded price of the same variation">{change === null ? "—" : `${change < 0 ? "↓ " : change > 0 ? "↑ " : ""}${formatChange(change)}%`}</span></>}</div><small>{price ? "Last checked: " + new Date(price.checked).toLocaleString("en-PH", {timeZone:"Asia/Manila"}) : "Open price history for latest details"}</small></div>
          </div>
          <div className="watchlist-card-actions"><a href={`/product/shopee/${p.external_shop_id}/${p.external_product_id}`}>View Price History</a><button onClick={() => remove(p.id)}>Remove</button></div>
        </article>;
      })}</div>}
    <footer className="watchlist-footer">
      <nav className="watchlist-pagination" aria-label="Watchlist pages">
        {totalPages > 1 && <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous</button>}
        <span className="watchlist-page-summary" aria-live="polite"><span>Total: {saved.length}</span>{totalPages > 1 && <span>Page {currentPage} of {totalPages}</span>}</span>
        {totalPages > 1 && <button type="button" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}>Next</button>}
      </nav>
    </footer>
  </div></main>;
}
