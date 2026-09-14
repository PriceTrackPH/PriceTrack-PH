export const COLLECTOR_PRODUCT_WAIT_MS = 120_000;
export const COLLECTOR_STOP_GRACE_MS = 30_000;

export function collectorProductWaitExpired(startedAt: number, now: number) {
  return now - startedAt >= COLLECTOR_PRODUCT_WAIT_MS;
}

export function collectorStopGraceExpired(stopRequestedAt: number | null, now: number) {
  return stopRequestedAt !== null && now - stopRequestedAt >= COLLECTOR_STOP_GRACE_MS;
}
