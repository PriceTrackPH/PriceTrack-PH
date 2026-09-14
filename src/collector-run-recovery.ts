export type CollectorStopStatus =
  | "stopped"
  | "stopped_safely"
  | "interrupted"
  | "login_expired"
  | "api_failure"
  | "confirmation_timeout";

export type CheckpointedCollectorProduct = {
  claimSource: "priority" | "store" | "random";
  queueRequestId: string | null;
  productId: number | null;
  shopId: string;
  externalProductId: string;
  productUrl: string;
  leaseUntil: string;
};

export type CollectorRunCheckpoint = {
  runId: string; startedAt: string; succeeded: number; failed: number;
  soldOut: number; recheckAt: string | null; samePrice: number;
  samePriceRecheckAt: string | null; remaining: number;
  phase?: "running" | "pending_finalization";
  intendedStopStatus?: CollectorStopStatus;
  failureReason?: "login_expired" | "api_failure" | "confirmation_timeout";
  activeProduct?: CheckpointedCollectorProduct | null;
};

export const activeCollectorRunKey = "pricetrack-admin-collector-active-run";

export function readCollectorRunCheckpoint(storage: Pick<Storage, "getItem">): CollectorRunCheckpoint | null {
  try {
    const value = JSON.parse(storage.getItem(activeCollectorRunKey) || "null");
    if (!value || typeof value.runId !== "string" || !Number.isFinite(Date.parse(value.startedAt))) return null;
    for (const key of ["succeeded", "failed", "soldOut", "samePrice", "remaining"] as const) {
      if (!Number.isInteger(value[key]) || value[key] < 0) return null;
    }
    if (value.phase && !["running", "pending_finalization"].includes(value.phase)) return null;
    const statuses = ["stopped", "stopped_safely", "interrupted", "login_expired", "api_failure", "confirmation_timeout"];
    if (value.intendedStopStatus && !statuses.includes(value.intendedStopStatus)) return null;
    if (value.failureReason && !["login_expired", "api_failure", "confirmation_timeout"].includes(value.failureReason)) return null;
    if (value.activeProduct) {
      const product = value.activeProduct;
      if (!["priority", "store", "random"].includes(product.claimSource)
        || (product.productId !== null && !Number.isInteger(product.productId))
        || typeof product.shopId !== "string"
        || typeof product.externalProductId !== "string"
        || typeof product.productUrl !== "string"
        || typeof product.leaseUntil !== "string") return null;
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
