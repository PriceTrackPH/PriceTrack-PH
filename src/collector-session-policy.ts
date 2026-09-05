export const COLLECTION_SUCCESS_LIMIT = 50;
export const COLLECTION_COOLDOWN_MS = 60 * 60 * 1000;

export function reachedCollectionLimit(succeeded: number) {
  return succeeded >= COLLECTION_SUCCESS_LIMIT;
}

export function cooldownEndAfterLimit(stoppedAt: number) {
  return stoppedAt + COLLECTION_COOLDOWN_MS;
}

export function cooldownSecondsRemaining(cooldownEnd: number, now: number) {
  return Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
}
