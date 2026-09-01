export function donationPageIndex(scrollLeft: number, pageWidth: number, pageCount: number) {
  if (pageWidth <= 0 || pageCount <= 1) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.round(scrollLeft / pageWidth)));
}
