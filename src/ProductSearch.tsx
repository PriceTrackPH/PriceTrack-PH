import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import "./product-search.css";

export type SearchSuggestion = {
  id: number; name: string; shop_name: string | null;
  external_shop_id: string; external_product_id: string;
};

export default function ProductSearch({ query, onChange, loading, onSubmit, onSelect }: {
  query: string; onChange: (value: string) => void; loading: boolean;
  onSubmit: (event: FormEvent) => void;
  onSelect: (product: SearchSuggestion) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const text = query.trim();
  const canSuggest = focused && !loading && text.length >= 2 && !/^https?:\/\//i.test(text);

  useEffect(() => {
    setSuggestions([]);
    setActive(-1);
    activeRef.current = -1;
    setUnavailable(false);
    setSearching(canSuggest);
    if (!canSuggest || !supabase) { setSearching(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      // Literal words, separated by wildcards, also match extra spaces in stored titles.
      const pattern = "%" + text.slice(0, 150).split(/\s+/)
        .map((word) => word.replace(/[\\%_]/g, "\\$&")).join("%") + "%";
      try {
        const { data, error } = await supabase!.from("products")
          .select("id,name,shop_name,external_shop_id,external_product_id")
          .eq("platform", "shopee").eq("is_active", true)
          .not("last_checked_at", "is", null)
          .ilike("name", pattern).order("name").order("id").limit(5)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        setSuggestions(error ? [] : data ?? []);
        setUnavailable(Boolean(error));
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [text, canSuggest]);

  function choose(item: SearchSuggestion) {
    setFocused(false);
    setSuggestions([]);
    onSelect(item);
  }

  return <div className="product-search" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }}>
    <form className="search-box" onSubmit={(event) => {
      if (canSuggest && activeRef.current >= 0 && suggestions[activeRef.current]) {
        event.preventDefault(); choose(suggestions[activeRef.current]); return;
      }
      setFocused(false); onSubmit(event);
    }}>
      <span className="link-mark">🔗</span>
      <input value={query} onChange={(event) => { setFocused(true); onChange(event.target.value); }}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setFocused(false); setActive(-1); activeRef.current = -1; }
          if (event.key === "Enter" && canSuggest && suggestions[activeRef.current]) {
            event.preventDefault(); choose(suggestions[activeRef.current]); return;
          }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
            event.preventDefault();
            const index = activeRef.current;
            activeRef.current = event.key === "ArrowDown" ? (index + 1) % suggestions.length
              : (index <= 0 ? suggestions.length - 1 : index - 1);
            setActive(activeRef.current);
          }
        }}
        placeholder="Search a product or paste a link..."
        aria-label="Product name or marketplace product link"
        role="combobox" aria-autocomplete="list" aria-expanded={canSuggest}
        aria-controls="product-suggestions"
        aria-activedescendant={active >= 0 ? "product-suggestion-" + active : undefined}
        autoComplete="off" />
      <button disabled={loading || !text}>
        {loading ? "Checking…" : "Check price"}
        {!loading && <span aria-hidden="true">→</span>}
      </button>
    </form>
    {canSuggest && <div className="product-suggestions">
      <div id="product-suggestions" role="listbox" aria-label="Matching products">
        {suggestions.map((item, index) => <button key={item.id} type="button"
          id={"product-suggestion-" + index} role="option" aria-selected={index === active}
          className={index === active ? "active" : ""}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <span className="suggestion-name">{item.name}</span>
          <small>{item.shop_name || "Shopee"} · {item.external_shop_id}.{item.external_product_id}</small>
        </button>)}
      </div>
      {!suggestions.length && <div className="suggestion-note" role="status">
        {searching ? "Finding products…" : unavailable
          ? "Suggestions unavailable. You can still search with a product link."
          : "No matching recorded products."}
      </div>}
    </div>}
  </div>;
}
