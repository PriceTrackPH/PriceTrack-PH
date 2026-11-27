import type { Tables } from "../database.types";

export type RoutedHistory = {
  product: Tables<"products">;
  variations: Tables<"product_variations">[];
  observations: Tables<"price_observations">[];
};

export async function routedHistory(shopId: string, productId: string): Promise<RoutedHistory | null> {
  const directoryEnabled = import.meta.env.VITE_PRICETRACK_DATABASE_ROUTING === "1";
  const pilotEnabled = import.meta.env.VITE_PRICETRACK_DB2_PILOT === "1" &&
    (import.meta.env.VITE_PRICETRACK_DB2_PRODUCTS || "").split(",").includes(`${shopId}:${productId}`);
  if (!directoryEnabled && !pilotEnabled) return null;
  const response = await fetch(`/api/observations?db2Pilot=1&${new URLSearchParams({shopId, productId})}`, {cache:"no-store"});
  const data = await response.json();
  // Only a disabled pilot allows the original DB1 path. An assigned product
  // missing from DB2 or a failed read must never display stale DB1 history.
  if (response.status === 404 && data.error === "Not in pilot") return null;
  if (!response.ok) throw Error("Unable to load recorded price history.");
  return data as RoutedHistory;
}
