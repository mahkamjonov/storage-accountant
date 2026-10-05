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
export const EXTRA_TYPES: MovementType[] = ['adjustment', 'written_off'];
/** Faqat Uzumga bog'lanmagan do'konda qo'lda kiritiladi. */
export const MANUAL_UZUM_TYPES: MovementType[] = ['to_uzum', 'sold', 'returned'];
