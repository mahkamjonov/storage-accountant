// Sana yordamchilari. Harakat sanasi YYYY-MM-DD ko'rinishida (mahalliy vaqt bo'yicha).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Mahalliy vaqt bo'yicha bugungi sana. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "12-mart", boshqa yil bo'lsa "12-mart, 2025". Bugun/kecha so'z bilan. */
export function formatDateLabel(iso: string, today: string = todayIso()): string {
  if (iso === today) return 'Bugun';
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  if (iso === t.toISOString().slice(0, 10)) return 'Kecha';
  const [y, m, d] = iso.split('-');
  const label = `${Number(d)}-${MONTHS[Number(m) - 1]}`;
  return y === today.slice(0, 4) ? label : `${label}, ${y}`;
}
