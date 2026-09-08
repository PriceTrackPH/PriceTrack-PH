export type CollectorRunCheckpoint = {
  runId: string; startedAt: string; succeeded: number; failed: number;
  soldOut: number; recheckAt: string | null; samePrice: number;
  samePriceRecheckAt: string | null; remaining: number;
};

export const activeCollectorRunKey = "pricetrack-admin-collector-active-run";

export function readCollectorRunCheckpoint(storage: Pick<Storage, "getItem">): CollectorRunCheckpoint | null {
  try {
    const value = JSON.parse(storage.getItem(activeCollectorRunKey) || "null");
    if (!value || typeof value.runId !== "string" || !Number.isFinite(Date.parse(value.startedAt))) return null;
    for (const key of ["succeeded", "failed", "soldOut", "samePrice", "remaining"] as const) {
      if (!Number.isInteger(value[key]) || value[key] < 0) return null;
    }
    return value;
  } catch { return null; }
}

export function saveCollectorRunCheckpoint(storage: Pick<Storage, "setItem">, value: CollectorRunCheckpoint) {
  storage.setItem(activeCollectorRunKey, JSON.stringify(value));
}

export function clearCollectorRunCheckpoint(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(activeCollectorRunKey);
}
