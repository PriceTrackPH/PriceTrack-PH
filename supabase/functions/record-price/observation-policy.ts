type LatestObservation = {
  price: number | string;
  original_price: number | string | null;
  is_in_stock: boolean;
  observed_at: string;
};

type IncomingObservation = {
  price: number;
  originalPrice?: number | null;
  isInStock: boolean;
};

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shouldSkipObservation(
  latest: LatestObservation | undefined,
  item: IncomingObservation,
  observedDate: string,
) {
  if (!latest) return false;

  const originalPrice = item.originalPrice == null ? null : Number(item.originalPrice);
  const sameState = Number(latest.price) === item.price &&
    latest.is_in_stock === item.isInStock &&
    (latest.original_price == null
      ? originalPrice == null
      : Number(latest.original_price) === originalPrice);

  if (!sameState) return false;

  const latestObservedAt = new Date(latest.observed_at);
  if (Number.isNaN(latestObservedAt.getTime())) return false;

  return manilaDateFormatter.format(latestObservedAt) === observedDate;
}
