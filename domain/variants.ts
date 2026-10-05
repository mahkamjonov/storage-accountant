// Variantlar: xususiyatlardan kombinatsiyalar yasash, nomlash va artikul taklif qilish.
import type { Attribute } from './types.ts';

/** Xususiyat va uning qiymatlari, masalan: Rang → [Qora, Oq]. */
export interface Characteristic {
  name: string;
  values: string[];
}

/** "Qora · L" — variantning qisqa nomi. Xususiyat bo'lmasa — bo'sh qator. */
export function variantLabel(attributes: readonly Attribute[]): string {
  return attributes.map((a) => a.value).join(' · ');
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Barcha kombinatsiyalar (Uzumdagi kabi): Rang [Qora, Oq] × O'lcham [M, L] → 4 variant.
 * Bo'sh xususiyatlar va takror qiymatlar tashlab yuboriladi. Xususiyat yo'q bo'lsa — bitta variant.
 */
export function buildVariantMatrix(characteristics: readonly Characteristic[]): Attribute[][] {
  const usable = characteristics
    .map((c) => ({
      name: clean(c.name),
      values: [...new Map(c.values.map((v) => clean(v)).filter(Boolean).map((v) => [v.toLowerCase(), v])).values()],
    }))
    .filter((c) => c.name && c.values.length > 0);

  let rows: Attribute[][] = [[]];
  for (const c of usable) {
    rows = rows.flatMap((row) => c.values.map((value) => [...row, { name: c.name, value }]));
  }
  return rows;
}

/** Artikulni solishtirish uchun: katta harf, bo'shliqlarsiz chetlar, bir xil tire. */
export function normalizeCode(code: string | null | undefined): string {
  return (code ?? '')
    .normalize('NFC')
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Asosiy artikul + qiymatlar: "HOODIE" + [Qora, L] → "HOODIE-QORA-L". */
export function suggestCode(base: string, attributes: readonly Attribute[]): string {
  const parts = [base, ...attributes.map((a) => a.value)]
    .map((p) => clean(p).replace(/\s+/g, '-'))
    .filter(Boolean);
  return normalizeCode(parts.join('-'));
}
