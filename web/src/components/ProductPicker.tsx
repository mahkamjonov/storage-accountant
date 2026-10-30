// Mahsulot qidiruvi: nom, rang/o'lcham va artikul bo'yicha.
import { variantLabel, type ProductWithStock, type VariantWithStock } from '../../../domain/index.ts';
import { normalizeSearch } from '../hooks.ts';

/** Qidiruv: kartochka nomi, variant xususiyatlari va artikul bo'yicha; har bir so'z topilishi kerak. */
export function matchesVariant(p: ProductWithStock, v: VariantWithStock | null, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const parts = [p.name, ...(v ? [variantLabel(v.attributes), v.code] : p.variants.flatMap((x) => [variantLabel(x.attributes), x.code]))];
  const hay = normalizeSearch(parts.filter(Boolean).join(' '));
  return q.split(' ').every((word) => hay.includes(word));
}
