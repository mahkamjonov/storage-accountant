// Uzum Seller OpenAPI mijozi. Hujjat: https://api-seller.uzum.uz/api/seller-openapi/swagger/swagger-ui/
// Faqat ilovaga kerakli endpointlar va maydonlar. Sinxronlash `UzumApi` interfeysiga tayanadi —
// testlarda soxta (fake) mijoz ishlatiladi.

export interface RawShop {
  id: number;
  name?: string;
}

export interface RawSku {
  skuId: number;
  skuTitle?: string;
  skuFullTitle?: string;
  productTitle?: string;
  article?: string | null;
  sellerItemCode?: string | null;
  barcode?: number | string | null;
  characteristics?: string | null;
  quantityActive?: number | null;
  archived?: boolean;
  previewImage?: string | null;
}

export interface RawProductCard {
  productId: number;
  title?: string;
  previewImg?: string | null;
  skuList?: RawSku[];
}

export interface RawInvoiceSku {
  id: number;
  skuTitle?: string;
  quantityToStock?: number | null;
  quantityAccepted?: number | null;
}

export interface RawInvoiceProduct {
  id: number;
  productTitle?: string;
  skuTitle?: string;
  quantityToStock?: number | null;
  skuForInvoiceDtoList?: RawInvoiceSku[] | null;
}

export interface RawInvoice {
  id: number;
  shopId?: number;
  invoiceNumber?: number | null;
  dateCreated?: string | number | null;
  dateAccepted?: string | null;
  status?: string | null;
  invoiceStatus?: { value?: string | null; text?: string | null } | null;
  totalToStock?: number | null;
  totalAccepted?: number | null;
  productForInvoiceDto?: RawInvoiceProduct[] | null;
}

export interface RawReturnItem {
  id: number;
  skuId?: number | null;
  amount?: number | null;
  skuTitle?: string;
  productTitle?: string;
}

export interface RawReturn {
  id: number;
  dateCreated?: string | number | null;
  completedDate?: string | null;
  canceledDate?: string | null;
  status?: string | null;
  type?: string | null;
  externalNumber?: string | null;
  returnItems?: RawReturnItem[] | null;
}

export interface RawOrderItem {
  id: number;
  orderId?: number;
  status?: string | null;
  date?: number | string | null;
  skuTitle?: string;
  sellerSkuCode?: string | null;
  productTitle?: string;
  shopId?: number;
  amount?: number | null;
  amountReturns?: number | null;
  cancelled?: number | null;
}

export interface RawFbsOrder {
  id: number;
  status?: string | null;
  /** FBS yoki DBS — ikkalasida ham tovar sotuvchining o'z omboridan jo'natiladi. */
  scheme?: string | null;
  shopId?: number;
  dateCreated?: string | number | null;
  orderItems?: RawOrderItem[] | null;
}

/** FBS/DBS buyurtma holatlari (Uzum API'da holatsiz so'rov bo'sh qaytadi, shuning uchun har biri alohida so'raladi). */
export const FBS_STATUSES = [
  'CREATED',
  'PACKING',
  'PENDING_DELIVERY',
  'DELIVERING',
  'DELIVERED',
  'ACCEPTED_AT_DP',
  'DELIVERED_TO_CUSTOMER_DELIVERY_POINT',
  'COMPLETED',
  'PENDING_CANCELLATION',
  'CANCELED',
  'RETURNED',
] as const;

export interface UzumApi {
  shops(): Promise<RawShop[]>;
  productsPage(shopId: number, page: number, size: number): Promise<{ productList: RawProductCard[]; totalProductsAmount?: number }>;
  /** Barcha do'konlarning FBO yetkazib berish nakladnoylari (tarkibi bilan). size ≤ 50. */
  invoicesPage(page: number, size: number): Promise<RawInvoice[]>;
  /** Nakladnoy tarkibi (agar ro'yxatda kelmagan bo'lsa). */
  invoiceProducts(shopId: number, invoiceId: number): Promise<RawInvoiceProduct[]>;
  /** Qaytarish nakladnoylari (Uzum → sotuvchi), tarkibi bilan. size ≤ 50. */
  returnsPage(page: number, size: number): Promise<RawReturn[]>;
  /** Sotuvlar (buyurtma qatorlari). */
  ordersPage(q: { shopIds: number[]; dateFrom: number; dateTo: number; page: number; size: number }): Promise<{
    orderItems: RawOrderItem[];
    totalElements?: number;
  }>;
  /** FBS/DBS buyurtmalari (sotuvchi o'z omboridan jo'natadi). size ≤ 50. */
  fbsOrdersPage(q: { shopIds: number[]; status: string; dateFrom: number; dateTo: number; page: number; size: number }): Promise<RawFbsOrder[]>;
}

export class UzumApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BASE_URL = 'https://api-seller.uzum.uz/api/seller-openapi';

export class HttpUzumApi implements UzumApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = BASE_URL,
    private readonly timeoutMs = 30_000,
    private readonly minGapMs = 400,
  ) {}

  private nextAt = 0;

  /** Uzum tez-tez so'rovlarni cheklaydi (429) — so'rovlar orasida kamida `minGapMs` pauza. */
  private async pace(): Promise<void> {
    const wait = this.nextAt - Date.now();
    this.nextAt = Math.max(Date.now(), this.nextAt) + this.minGapMs;
    if (wait > 0) await sleep(wait);
  }

  private async get<T>(path: string, query: Record<string, string | number | number[] | undefined> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
      else url.searchParams.set(k, String(v));
    }

    for (let attempt = 0; ; attempt++) {
      await this.pace();
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new UzumApiError(0, "Uzum serveriga ulanib bo'lmadi. Internet aloqasini tekshiring.");
      }
      // Juda ko'p so'rov (Uzum cheklovi) yoki vaqtinchalik xato — kutib, qayta urinamiz.
      if (res.status === 429 && attempt < 6) {
        await sleep(Math.min(1500 * 2 ** attempt, 15_000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (res.status === 429) {
        throw new UzumApiError(429, "Uzum hozir juda ko'p so'rov deyapti. Bir necha daqiqadan keyin qayta yangilang.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new UzumApiError(res.status, "Uzum API kaliti qabul qilinmadi. Kalitni tekshiring yoki Uzum kabinetida yangisini yarating.");
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new UzumApiError(res.status, `Uzum xato qaytardi (${res.status}) — ${path}. ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    }
  }

  async shops(): Promise<RawShop[]> {
    const data = await this.get<RawShop[] | { payload?: RawShop[] }>('/v1/shops');
    return Array.isArray(data) ? data : (data.payload ?? []);
  }

  async productsPage(shopId: number, page: number, size: number) {
    const data = await this.get<{ productList?: RawProductCard[]; totalProductsAmount?: number }>(`/v1/product/shop/${shopId}`, {
      page,
      size,
    });
    return { productList: data.productList ?? [], totalProductsAmount: data.totalProductsAmount };
  }

  async invoicesPage(page: number, size: number): Promise<RawInvoice[]> {
    return unwrapList(await this.get<unknown>('/v1/invoice', { page, size }));
  }

  async invoiceProducts(shopId: number, invoiceId: number): Promise<RawInvoiceProduct[]> {
    return unwrapList(await this.get<unknown>(`/v1/shop/${shopId}/invoice/products`, { invoiceId }));
  }

  async returnsPage(page: number, size: number): Promise<RawReturn[]> {
    return unwrapList(await this.get<unknown>('/v1/return', { page, size }));
  }

  async ordersPage(q: { shopIds: number[]; dateFrom: number; dateTo: number; page: number; size: number }) {
    const data = await this.get<{ orderItems?: RawOrderItem[]; totalElements?: number; payload?: { orderItems?: RawOrderItem[]; totalElements?: number } }>(
      '/v1/finance/orders',
      { shopIds: q.shopIds, dateFrom: q.dateFrom, dateTo: q.dateTo, page: q.page, size: q.size, group: 'false' },
    );
    const body = data.payload ?? data;
    return { orderItems: body.orderItems ?? [], totalElements: body.totalElements };
  }

  async fbsOrdersPage(q: { shopIds: number[]; status: string; dateFrom: number; dateTo: number; page: number; size: number }) {
    return fetchFbsOrdersPage((path, query) => this.get(path, query), q);
  }
}

export async function fetchFbsOrdersPage(
  get: <T>(path: string, query: Record<string, string | number | number[] | undefined>) => Promise<T>,
  q: { shopIds: number[]; status: string; dateFrom: number; dateTo: number; page: number; size: number },
): Promise<RawFbsOrder[]> {
  const data = await get<{ payload?: { orders?: RawFbsOrder[] } }>('/v2/fbs/orders', {
    shopIds: q.shopIds,
    status: q.status,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    page: q.page,
    size: q.size,
  });
  return data.payload?.orders ?? [];
}

/** Ba'zi javoblar ro'yxat, ba'zilari { payload: [...] } ko'rinishida keladi. */
function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const payload = (data as { payload?: unknown }).payload;
    if (Array.isArray(payload)) return payload as T[];
    if (payload && typeof payload === 'object') return [payload as T];
  }
  return [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
