// Ilovaning asosiy tushunchalari. Bu fayl na bazaga, na serverga, na brauzerga bog'liq.

/** Qoldiq joyi: sotuvchining o'z ombori yoki Uzum ombori. */
export type Location = 'own' | 'uzum';

/**
 * Harakat turlari:
 * - received     — yetkazib beruvchidan mahsulot keldi (omborim +)
 * - to_uzum      — Uzumga jo'natildi (omborim −, Uzum +)
 * - sold         — Uzumda sotildi (Uzum −)
 * - returned     — Uzumdan qaytdi (omborim +, Uzum −)
 * - written_off  — brak / yo'qolgan (tanlangan joydan −)
 * - adjustment   — sanab tuzatish (tanlangan joyda farq + yoki −)
 */
export type MovementType = 'received' | 'to_uzum' | 'sold' | 'returned' | 'written_off' | 'adjustment';

export const MOVEMENT_TYPES: readonly MovementType[] = [
  'received',
  'to_uzum',
  'sold',
  'returned',
  'written_off',
  'adjustment',
];

/** Faqat sanab tuzatish uchun: farq qaysi tomonga. */
export type Direction = 'increase' | 'decrease';

/** Do'kon. Har bir do'konning hisobi (kartochkalar, qoldiq, tarix) alohida. */
export interface Shop {
  id: string;
  name: string;
  /** Uzumdagi do'kon (shopId), bog'langan bo'lsa. */
  uzumShopId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopWithStats extends Shop {
  productCount: number;
}

/** Mahsulot kartochkasi (Uzumdagi kabi): umumiy nom, ichida variantlar. */
export interface Product {
  id: string;
  shopId: string;
  name: string;
  /** Har bir variant qoldig'i shu songa teng yoki kam bo'lsa — "tugab qolmoqda". */
  lowStockThreshold: number;
  archived: boolean;
  /** Uzumdagi kartochka (productId), bog'langan bo'lsa. */
  uzumProductId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Variantning bitta xususiyati, masalan { name: "Rang", value: "Qora" }. */
export interface Attribute {
  name: string;
  value: string;
}

/** Variant (SKU): kartochka ichidagi aniq rang/o'lcham. Qoldiq variant bo'yicha yuritiladi. */
export interface Variant {
  id: string;
  productId: string;
  /** Sotuvchi artikuli. Uzumdagi artikul bilan bir xil bo'lsa, avtomatik bog'lanadi. */
  code: string | null;
  attributes: Attribute[];
  archived: boolean;
  /** Uzumdagi SKU (skuId), bog'langan bo'lsa. */
  uzumSkuId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Harakat qayerdan kelgan: qo'lda kiritilgan yoki Uzumdan avtomatik. */
export type MovementSource = 'manual' | 'uzum';

export interface Movement {
  id: string;
  variantId: string;
  type: MovementType;
  /** Doim musbat butun son. */
  quantity: number;
  /** Faqat written_off va adjustment uchun. */
  location: Location | null;
  /** Faqat adjustment uchun. */
  direction: Direction | null;
  /** Faqat adjustment uchun: sotuvchi sanagan haqiqiy son (tarixda ko'rsatish uchun). */
  countedQuantity: number | null;
  note: string | null;
  /** Harakat sanasi, YYYY-MM-DD. */
  date: string;
  /** Yozuv yaratilgan vaqt, ISO. */
  createdAt: string;
  /** Bekor qilingan vaqt, ISO. null — amalda. */
  voidedAt: string | null;
  source: MovementSource;
  /** Uzumdagi hujjat, masalan "Nakladnoy №1234". */
  sourceLabel: string | null;
}

export interface Stock {
  own: number;
  uzum: number;
  total: number;
}

/** Qoldiqqa ta'sir qiladigan maydonlar. */
export type MovementEffectInput = Pick<Movement, 'type' | 'quantity' | 'location' | 'direction'>;

export interface VariantWithStock extends Variant {
  stock: Stock;
  /** Qoldiq "tugab qolmoqda" chegarasidan oshmaydi. */
  low: boolean;
  /** Oxirgi harakat vaqti — tez-tez ishlatiladiganlarni yuqoriga chiqarish uchun. */
  lastMovementAt: string | null;
  /** Uzum ma'lumoti bo'yicha Uzum omboridagi son (oxirgi yangilashda). */
  uzumReported: number | null;
}

/** Kartochka, uning variantlari va hisoblangan qoldig'i (API javobi). */
export interface ProductWithStock extends Product {
  variants: VariantWithStock[];
  /** Barcha variantlar yig'indisi. */
  stock: Stock;
  /** Kamida bitta variant tugab qolmoqda. */
  low: boolean;
  lastMovementAt: string | null;
}
