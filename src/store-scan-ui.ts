export type RecheckStore = { id: string; storeUrl: string };

export function formatPageProgress(current: number, total: number) {
  if (current <= 0 && total <= 0) return "—";
  return total > 0 ? `${current}/${total}` : String(current);
}

export function runningTimeLabel(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "—";
  const seconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}

export function nextUnscannedStore<T extends RecheckStore>(stores: T[], completedIds: ReadonlySet<string>): T | null {
  return stores.find((store) => !completedIds.has(store.id)) || null;
}
