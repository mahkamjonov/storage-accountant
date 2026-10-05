// Uzum javoblarini ilova tushunchalariga aylantirish — sof funksiyalar (tarmoq va bazasiz, test qilish oson).
import { normalizeCode, todayIso, type Attribute, type UzumEventDraft, type UzumSku } from '../../../domain/index.ts';
import type { RawFbsOrder, RawInvoice, RawInvoiceProduct, RawOrderItem, RawProductCard, RawReturn } from './client.ts';

/**
 * Uzum sanalari turlicha keladi: ms (son), ISO qator yoki "dd.MM.yyyy HH:mm".
 * Natija — mahalliy vaqt bo'yicha YYYY-MM-DD, tushunilmasa null.
 */
export function parseUzumDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d{10,}$/.test(String(value))) {
    const d = new Date(Number(value));
    return Number.isNaN(d.getTime()) ? null : todayIso(d);
  }
  const s = String(value).trim();
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (ru) {
    const [, dd, mm, yyyy] = ru;
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : todayIso(d);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Bitta do'kon katalogi. `shopId` — Uzumdagi do'kon. */
export function mapCatalog(cards: RawProductCard[], shopId = 0, now = new Date().toISOString()): UzumSku[] {
  const result: UzumSku[] = [];
  const seen = new Set<number>();
  for (const card of cards) {
    for (const sku of card.skuList ?? []) {
      if (typeof sku.skuId !== 'number' || seen.has(sku.skuId)) continue;
      seen.add(sku.skuId);
      result.push({
        skuId: sku.skuId,
        shopId,
        productId: card.productId,
        productTitle: str(card.title) ?? str(sku.productTitle) ?? '',
        // skuFullTitle — sotuvchi kabinetda ko'radigan to'liq kod ("DINAMUZ-JORDAN-БЕЖЕВ-L"),
        // skuTitle esa faqat qisqa qismi ("БЕЖЕВ-L"). Nakladnoy va sotuvlarda to'liq kod keladi.
        skuTitle: str(sku.skuFullTitle) ?? str(sku.skuTitle) ?? String(sku.skuId),
        article: str(sku.article),
        sellerSkuCode: str(sku.sellerItemCode),
        barcode: str(sku.barcode),
        characteristics: str(sku.characteristics),
        image: str(sku.previewImage) ?? str(card.previewImg),
        quantityActive: Math.max(0, int(sku.quantityActive)),
        archived: sku.archived === true,
        updatedAt: now,
      });
    }
  }
  return result;
}

/**
 * "Цвет: Бежевый, Размер одежды: L" → [{Цвет, Бежевый}, {Размер одежды, L}].
 * Formati tushunilmasa — bitta "Variant" xususiyati.
 */
export function parseCharacteristics(text: string | null | undefined): Attribute[] {
  const s = str(text);
  if (!s) return [];
  const parts = s.split(/\s*[,;·|]\s*/).filter(Boolean);
  // Uzum ko'pincha faqat qiymatlarni beradi: "L, Sargʻish" — nomini qiymat ko'rinishidan taxmin qilamiz.
  if (parts.every((p) => !p.includes(':'))) return nameBareValues(parts);
  const attrs: Attribute[] = [];
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i <= 0) return [{ name: 'Variant', value: s }];
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || !value || attrs.some((a) => a.name.toLowerCase() === name.toLowerCase())) return [{ name: 'Variant', value: s }];
    attrs.push({ name, value });
  }
  return attrs;
}

const SIZE = /^(X{0,4}S|M|X{0,4}L|\d?X{1,4}L|\d{2,3}(-\d{2,3})?|\d{2,3}[x×]\d{2,3})$/i;
const MEASURE = /^\d+([.,]\d+)?\s*(l|ml|л|мл|kg|g|gr|кг|г|sm|cm|mm|m|см|мм|м|dona|шт)$/i;

/** "L, Sargʻish" → O'lcham: L, Rang: Sargʻish; "Yashil, 0.5l" → Rang: Yashil, Hajm: 0.5l. */
function nameBareValues(values: string[]): Attribute[] {
  const attrs: Attribute[] = [];
  const used = new Set<string>();
  const take = (name: string) => {
    let n = name;
    for (let k = 2; used.has(n); k++) n = `${name} ${k}`;
    used.add(n);
    return n;
  };
  for (const value of values) {
    const v = value.trim();
    if (SIZE.test(v)) attrs.push({ name: take("O'lcham"), value: v });
    else if (MEASURE.test(v)) attrs.push({ name: take('Hajm'), value: v });
    else if (!used.has('Rang') && !/^\d+$/.test(v)) attrs.push({ name: take('Rang'), value: v });
    else attrs.push({ name: take('Turi'), value: v });
  }
  // Tabiiy o'qilishi uchun: "Qora · L", "Yashil · 0.5l"
  const order = (name: string) => ['Rang', "O'lcham", 'Hajm'].findIndex((n) => name.startsWith(n)) >>> 0;
  return attrs.sort((x, y) => order(x.name) - order(y.name));
}

/** Uzum SKU'sini ilovadagi variant bilan solishtirish uchun mumkin bo'lgan artikullar. */
export function candidateCodes(sku: Pick<UzumSku, 'sellerSkuCode' | 'article' | 'skuTitle'>): string[] {
  return [sku.sellerSkuCode, sku.article, sku.skuTitle].filter((c): c is string => Boolean(c));
}

function isCancelled(status: string | null | undefined): boolean {
  return /CANCEL/i.test(status ?? '');
}

export function invoiceStatus(inv: RawInvoice): string {
  return str(inv.invoiceStatus?.value) ?? str(inv.status) ?? '';
}

/** Nakladnoy tarkibidagi har bir SKU — "Uzumga jo'natdim". Omborimdan shu son chiqib ketgan. */
export function invoiceEvents(inv: RawInvoice, products: RawInvoiceProduct[]): UzumEventDraft[] {
  const date = parseUzumDate(inv.dateCreated) ?? todayIso();
  const label = `Nakladnoy №${inv.invoiceNumber ?? inv.id}`;
  const cancelled = isCancelled(invoiceStatus(inv));
  const events: UzumEventDraft[] = [];
  for (const p of products) {
    for (const s of p.skuForInvoiceDtoList ?? []) {
      events.push({
        externalRef: `invoice:${inv.id}:sku:${s.id}`,
        kind: 'to_uzum',
        uzumShopId: typeof inv.shopId === 'number' ? inv.shopId : null,
        location: null,
        uzumSkuId: s.id,
        skuTitle: str(s.skuTitle),
        sellerSkuCode: null,
        productTitle: str(p.productTitle),
        quantity: Math.max(0, int(s.quantityToStock)),
        date,
        label,
        cancelled,
      });
    }
  }
  return events;
}

/**
 * Qaytarish nakladnoyi (Uzum omboridan sotuvchiga) — "Qaytdi". Faqat yakunlangani (tovar sotuvchiga topshirilgan) hisoblanadi.
 * FBS qaytarishlari bu yerda o'tkaziladi — ular FBS buyurtmaning o'zida (qaytarilgan son ayirilib) hisobga olinadi.
 * Yakunlanmagan bo'lsa — null (hali hech narsa yozilmaydi).
 */
export function returnEvents(ret: RawReturn): UzumEventDraft[] | null {
  if (/FBS/i.test(ret.type ?? '')) return [];
  const status = str(ret.status) ?? '';
  const cancelled = isCancelled(status) || Boolean(ret.canceledDate);
  const completed = /COMPLET/i.test(status) || Boolean(ret.completedDate);
  if (!completed && !cancelled) return null;
  const date = parseUzumDate(ret.completedDate) ?? parseUzumDate(ret.dateCreated) ?? todayIso();
  const label = `Qaytarish №${ret.externalNumber ?? ret.id}${/DEFECT/i.test(ret.type ?? '') ? ' (brak)' : ''}`;
  return (ret.returnItems ?? []).map((item) => ({
    externalRef: `return:${ret.id}:item:${item.id}`,
    kind: 'returned' as const,
    uzumShopId: null, // javobda do'kon yo'q — SKU orqali aniqlanadi
    location: null,
    uzumSkuId: typeof item.skuId === 'number' ? item.skuId : null,
    skuTitle: str(item.skuTitle),
    sellerSkuCode: null,
    productTitle: str(item.productTitle),
    quantity: Math.max(0, int(item.amount)),
    date,
    label,
    cancelled,
  }));
}

/** Sotuv qatorining aniq soni: bekor qilingan va xaridor qaytargan sonlar ayiriladi. */
function netAmount(o: RawOrderItem): number {
  return int(o.amount) - int(o.cancelled) - int(o.amountReturns);
}

/**
 * Sotuv hodisalari: bir buyurtmadagi bir SKU — bitta hodisa (kalit "order:<buyurtma>:<SKU kodi>").
 * Sotuvlar ro'yxati va FBS buyurtmalari bir xil kalit beradi — bitta buyurtma ikki marta yozilmaydi.
 * `location: 'own'` — FBS/DBS (omborimdan), aks holda FBO (Uzum omboridan).
 */
export function orderEvents(
  items: RawOrderItem[],
  opts: { location: 'own' | null; label: (orderId: number) => string; cancelled?: boolean; date?: string | null; shopId?: number },
): UzumEventDraft[] {
  const groups = new Map<string, UzumEventDraft>();
  for (const o of items) {
    const orderId = o.orderId ?? o.id;
    const code = str(o.sellerSkuCode) ?? str(o.skuTitle) ?? String(o.id);
    const ref = `order:${orderId}:${normalizeCode(code)}`;
    const net = o.status === 'CANCELED' ? 0 : Math.max(0, netAmount(o));
    const prev = groups.get(ref);
    if (prev) {
      prev.quantity += net;
      continue;
    }
    groups.set(ref, {
      externalRef: ref,
      kind: 'sold',
      uzumShopId: typeof o.shopId === 'number' ? o.shopId : (opts.shopId ?? null),
      location: opts.location,
      uzumSkuId: null,
      skuTitle: str(o.skuTitle),
      sellerSkuCode: str(o.sellerSkuCode),
      productTitle: str(o.productTitle),
      quantity: net,
      date: opts.date ?? parseUzumDate(o.date) ?? todayIso(),
      label: opts.label(orderId),
      cancelled: false,
    });
  }
  return [...groups.values()].map((e) => ({ ...e, cancelled: opts.cancelled === true || e.quantity <= 0 }));
}

/** Sotuvlar ro'yxatidagi (FBO) qatorlar — "Sotildi", Uzum omboridan. */
export function financeOrderEvents(items: RawOrderItem[]): UzumEventDraft[] {
  return orderEvents(items, { location: null, label: (id) => `Buyurtma №${id}` });
}

/**
 * FBS/DBS buyurtma — "Sotildi (FBS)": tovar sotuvchining o'z omboridan jo'natiladi, buyurtma yaratilishi bilan ayiriladi.
 * Bekor qilingan yoki qaytarilgan buyurtma — yozuv bekor qilinadi (tovar omborga qaytadi).
 */
export function fbsOrderEvents(order: RawFbsOrder): UzumEventDraft[] {
  const status = str(order.status) ?? '';
  return orderEvents(order.orderItems ?? [], {
    location: 'own',
    label: (id) => `FBS buyurtma №${id}`,
    cancelled: status === 'CANCELED' || status === 'RETURNED',
    date: parseUzumDate(order.dateCreated),
    shopId: order.shopId,
  });
}

/** Bitta sotuv qatori (testlar uchun qulay). */
export function orderEvent(o: RawOrderItem): UzumEventDraft {
  return financeOrderEvents([o])[0]!;
}
