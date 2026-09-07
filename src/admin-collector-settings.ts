export function skipUnchangedDayDefault(storedValue: string | null) {
  return storedValue !== "false";
}

export function productUrlWithSkipUnchangedDay(productUrl: string, enabled: boolean) {
  const url = new URL(productUrl);
  url.searchParams.set("ptph_skip_unchanged", enabled ? "1" : "0");
  return url.toString();
}
