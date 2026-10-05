import { LOCATION_LABEL, movementEffect, variantLabel, type Movement, type Product, type Variant } from '../../domain/index.ts';

const nf = new Intl.NumberFormat('ru-RU');

/** 12 345 ko'rinishida (bo'sh joy bilan ajratilgan). */
export function num(n: number): string {
  return nf.format(n).replace(/ | /g, ' ');
}

export function signed(n: number): string {
  if (n > 0) return `+${num(n)}`;
  if (n < 0) return `−${num(-n)}`;
  return '0';
}

/** Variant nomi: "Qora · L". Xususiyatsiz variant — "Asosiy". */
export function variantName(v: Pick<Variant, 'attributes'>): string {
  return variantLabel(v.attributes) || 'Asosiy';
}

/** "Hoodie · Qora · L" (xususiyatsiz variantda faqat kartochka nomi). */
export function fullName(p: Pick<Product, 'name'>, v: Pick<Variant, 'attributes'> | null | undefined): string {
  const label = v ? variantLabel(v.attributes) : '';
  return label ? `${p.name} · ${label}` : p.name;
}

/** "Omborim −30 · Uzum +30" */
export function effectParts(m: Movement): { label: string; delta: number; location: 'own' | 'uzum' }[] {
  const e = movementEffect(m);
  const parts: { label: string; delta: number; location: 'own' | 'uzum' }[] = [];
  if (e.own !== 0) parts.push({ label: LOCATION_LABEL.own, delta: e.own, location: 'own' });
  if (e.uzum !== 0) parts.push({ label: 'Uzum', delta: e.uzum, location: 'uzum' });
  return parts;
}

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "5 daqiqa oldin", "2 soat oldin", "kecha 14:30" kabi. */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'hozirgina';
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} soat oldin`;
  const d = new Date(iso);
  return `${d.toLocaleDateString('ru-RU')} ${timeOf(iso)}`;
}
