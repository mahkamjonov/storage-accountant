// Harakat turlari bo'yicha interfeys matnlari va manzillari.
import { MOVEMENT_TYPES, type MovementType } from '../../domain/index.ts';

/** URL'dagi qisqa nomlar: /kiritish/keldi */
export const TYPE_SLUG: Record<MovementType, string> = {
  received: 'keldi',
  to_uzum: 'jonatdim',
  sold: 'sotildi',
  returned: 'qaytdi',
  written_off: 'brak',
  adjustment: 'sanash',
};

export function typeFromSlug(slug: string | undefined): MovementType | null {
  return MOVEMENT_TYPES.find((t) => TYPE_SLUG[t] === slug) ?? null;
}

/** Kiritish manzili. `variantId` — variant tanlangan holda; `productId` — faqat shu kartochka variantlaridan tanlash. */
export function entryPath(type: MovementType, opts: { variantId?: string; productId?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.variantId) params.set('variant', opts.variantId);
  else if (opts.productId) params.set('kartochka', opts.productId);
  const q = params.toString();
  return `/kiritish/${TYPE_SLUG[type]}${q ? `?${q}` : ''}`;
}

/** Sotuvchi o'zi kiritadigan amallar. Uzum bilan bog'langan do'konda jo'natish, sotuv va qaytarish Uzumdan avtomatik keladi. */
export const MAIN_TYPE: MovementType = 'received';
/** Mahsulot sahifasida qo'shimcha amal (bosh sahifada ko'rinmaydi). */
export const EXTRA_TYPES: MovementType[] = ['adjustment'];

/** Tugma va sahifa sarlavhalari: "nima qilaman" shaklida. Tarixdagi yozuv nomi esa TYPE_LABEL. */
export const ACTION_LABEL: Record<MovementType, string> = {
  received: "Omborga qo'shish",
  to_uzum: "Uzumga jo'natdim",
  sold: 'Sotildi',
  returned: 'Qaytdi',
  written_off: "Brak / yo'qolgan",
  adjustment: 'Sanab tuzatish',
};
/** Faqat Uzumga bog'lanmagan do'konda qo'lda kiritiladi. */
export const MANUAL_UZUM_TYPES: MovementType[] = ['to_uzum', 'sold', 'returned'];
