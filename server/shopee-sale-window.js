// Sale dates are interpreted as Philippine calendar days, without browser timezone drift.
export function isShopeeSaleWindow(manilaDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manilaDate)) return false;
  const date = new Date(`${manilaDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== manilaDate) return false;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month, 0)).getUTCDate();
  return day >= Math.min(29, lastDay) || day === 1
    || (day >= 14 && day <= 16)
    || (day >= month - 1 && day <= month + 1);
}

export function skipNextDayForUnchangedPrice(manilaDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manilaDate)) return false;
  const date = new Date(`${manilaDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== manilaDate) return false;
  const nextDay = new Date(date.getTime() + 86400_000).toISOString().slice(0, 10);
  return !isShopeeSaleWindow(manilaDate) && !isShopeeSaleWindow(nextDay);
}
