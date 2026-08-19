/** Local-date helpers. All program logic uses YYYY-MM-DD strings. */

export type ISODate = string;

export function isoDate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** The Monday of the week containing `date`. Programs start on Mondays. */
export function mondayOf(date: ISODate): ISODate {
  const d = parseISO(date);
  const dow = d.getDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(date, -back);
}

/** The next Monday strictly after or equal to `date`. */
export function nextMonday(date: ISODate): ISODate {
  const d = parseISO(date);
  const dow = d.getDay();
  if (dow === 1) return date;
  const ahead = dow === 0 ? 1 : 8 - dow;
  return addDays(date, ahead);
}
