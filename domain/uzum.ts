// Uzum Market bilan sinxronlash tushunchalari (faqat turlar va sof funksiyalar).

/** Uzum katalogidagi bitta SKU — oxirgi yangilashdagi holat. */
export interface UzumSku {
  skuId: number;
  /** Uzumdagi do'kon. */
  shopId: number;
  productId: number;
  productTitle: string;
  skuTitle: string;
  /** Uzumdagi "Артикул". */
  article: string | null;
  /** Sotuvchi artikuli (sellerItemCode / sellerSkuCode). */
  sellerSkuCode: string | null;
  barcode: string | null;
  /** Masalan: "Цвет: Бежевый, Размер одежды: L". */
  characteristics: string | null;
  image: string | null;
  /** Uzum omboridagi sotuvga tayyor son. */
  quantityActive: number;
  archived: boolean;
  updatedAt: string;
}

/** Uzumdan kelgan hodisa qaysi harakatga aylanadi. */
export type UzumEventKind = 'to_uzum' | 'sold' | 'returned';

/**
 * - applied    — harakat sifatida yozildi
 * - pending    — yozib bo'lmadi (masalan, omborda yetarli emas), sabab `reason` da; keyin avtomatik qayta uriniladi
 * - unmatched  — bu SKU ilovadagi qaysi variant ekani noma'lum (artikul mos kelmadi)
 * - cancelled  — Uzumda bekor qilingan (yozilgan bo'lsa, harakat ham bekor qilinadi)
 * - ignored    — sotuvchi harakatni qo'lda bekor qilgan; qayta yozilmaydi
 */
export type UzumEventStatus = 'applied' | 'pending' | 'unmatched' | 'cancelled' | 'ignored';

export interface UzumEvent {
  id: string;
  /** Takrorlanmas kalit, masalan "invoice:123:sku:456". Bir hodisa ikki marta yozilmaydi. */
  externalRef: string;
  kind: UzumEventKind;
  /** Uzumdagi do'kon (ma'lum bo'lsa). */
  uzumShopId: number | null;
  /** 'own' — FBS/DBS: sotuv sotuvchining o'z omboridan. null — Uzum omboridan (FBO). */
  location: 'own' | null;
  uzumSkuId: number | null;
  skuTitle: string | null;
  sellerSkuCode: string | null;
  productTitle: string | null;
  quantity: number;
  /** YYYY-MM-DD */
  date: string;
  /** Hujjat nomi: "Nakladnoy №123", "Buyurtma №456". */
  label: string;
  status: UzumEventStatus;
  reason: string | null;
  variantId: string | null;
  movementId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Uzumdan olingan, hali bazaga yozilmagan hodisa. */
export type UzumEventDraft = Pick<
  UzumEvent,
  | 'externalRef'
  | 'kind'
  | 'uzumShopId'
  | 'location'
  | 'uzumSkuId'
  | 'skuTitle'
  | 'sellerSkuCode'
  | 'productTitle'
  | 'quantity'
  | 'date'
  | 'label'
> & {
  /** Uzumda bekor qilingan. */
  cancelled: boolean;
};

export interface UzumStatus {
  /** API kaliti sozlanganmi. */
  configured: boolean;
  shopIds: number[];
  /** Shu sanadan boshlab hujjatlar hisobga olinadi. */
  syncFrom: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  running: boolean;
  counts: Record<UzumEventStatus, number>;
}
