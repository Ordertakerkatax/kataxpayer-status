/**
 * Manila times, formatted by hand. Manila has had no daylight saving since 1978,
 * so it is always UTC+8, and doing the sum ourselves means the server and the
 * browser print exactly the same string: Intl output differs between Node and
 * browsers (a narrow no-break space before "PM" in some), which React reports as
 * a hydration mismatch.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function manila(at: string | number | Date) {
  const d = new Date(new Date(at).getTime() + MANILA_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}

/** "9:05 PM" */
export function manilaTime(at: string | number | Date): string {
  const { h, mi } = manila(at);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2 Nov 2026" */
export function manilaDate(at: string | number | Date): string {
  const { y, mo, day } = manila(at);
  return `${day} ${MONTHS[mo]} ${y}`;
}

/** "9:05 PM" today, "2 Nov, 9:05 PM" any other day. */
export function manilaWhen(at: string | number | Date, now: string | number | Date = Date.now()): string {
  const a = manila(at);
  const n = manila(now);
  const sameDay = a.y === n.y && a.mo === n.mo && a.day === n.day;
  return sameDay ? manilaTime(at) : `${a.day} ${MONTHS[a.mo]}, ${manilaTime(at)}`;
}

/** "2026-11-02", the Manila calendar day. */
export function manilaDay(at: string | number | Date = Date.now()): string {
  const { y, mo, day } = manila(at);
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** For a `datetime-local` input: "2026-10-29T17:00", in Manila. */
export function toManilaInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + MANILA_OFFSET_MS);
  return d.toISOString().slice(0, 16);
}

/** Back from a `datetime-local` input, read as Manila time; null when empty or invalid. */
export function fromManilaInput(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
