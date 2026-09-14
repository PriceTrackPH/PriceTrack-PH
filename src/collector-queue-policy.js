export function nextNonPrioritySource(cadenceIndex) {
  const normalized = Number.isInteger(cadenceIndex) && cadenceIndex >= 0 ? cadenceIndex : 0;
  return normalized % 3 === 0 ? "store" : "normal";
}
