export function readNqCycle(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    return value && Number.isInteger(value.recorded) && value.recorded >= 0 && value.recorded <= 75
      ? { recorded: value.recorded, lowDone: value.lowDone === true }
      : { recorded: 0, lowDone: false };
  } catch { return { recorded: 0, lowDone: false }; }
}

export function nqCycleMode(state) {
  if (state.recorded >= 75) return "unavailable";
  if (state.recorded >= 50 && !state.lowDone) return "low";
  return null;
}

export function advanceNqCycle(state, product) {
  let next = { ...state };
  if (product.nqCycleMode === "low") next.lowDone = true;
  if (product.nqCycleMode === "unavailable") next = { recorded: 0, lowDone: false };
  if (!product.nqCycleMode || product.nqCycleFallback) next.recorded += 1;
  return next;
}
