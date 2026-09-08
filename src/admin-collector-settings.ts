export function skipUnchangedDayDefault(storedValue: string | null) {
  return storedValue !== "false";
}

export function skipSoldOutDefault(storedValue: string | null) {
  return storedValue !== "false";
}

export function productUrlWithCollectorOptions(productUrl: string, skipUnchangedDay: boolean, skipSoldOut: boolean) {
  const url = new URL(productUrl);
  url.searchParams.set("ptph_skip_unchanged", skipUnchangedDay ? "1" : "0");
  url.searchParams.set("ptph_skip_sold_out", skipSoldOut ? "1" : "0");
  return url.toString();
}

export const productUrlWithSkipUnchangedDay = (productUrl: string, enabled: boolean) =>
  productUrlWithCollectorOptions(productUrl, enabled, true);
