// Server bilan aloqa. Interfeys faqat shu funksiyalardan foydalanadi.
import type {
  Attribute,
  Location,
  Movement,
  MovementType,
  ProductWithStock,
  ShopWithStats,
  Stock,
  UzumEvent,
  UzumEventStatus,
  UzumSku,
  UzumStatus,
  VariantWithStock,
} from '../../domain/index.ts';

export interface User {
  id: string;
  login: string;
  displayName: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Ma'lumot o'zgarganda (saqlash, bekor qilish, tahrirlash) ochiq sahifalar qayta yuklanadi. */
export const dataChanged = new EventTarget();

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Joriy do'kon — har so'rovda serverga yuboriladi (ShopProvider o'rnatadi). */
let currentShopId: string | null = null;
export function setCurrentShopId(id: string | null) {
  currentShopId = id;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(currentShopId ? { 'x-shop-id': currentShopId } : {}) },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', "Internet aloqasi yo'q. Aloqani tekshirib, qaytadan urinib ko'ring.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? "Kutilmagan xatolik. Bir ozdan keyin qaytadan urinib ko'ring.",
    );
  }
  if (method !== 'GET' && !path.startsWith('/auth/')) dataChanged.dispatchEvent(new Event('change'));
  return data as T;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  variant: VariantWithStock;
}

export interface Overview {
  totals: Stock;
  productCount: number;
  variantCount: number;
  low: LowStockItem[];
  /** Bugun Uzumdan avtomatik kelganlar (dona). */
  uzumToday: { to_uzum: number; sold_fbo: number; sold_fbs: number; returned: number };
}

export interface BatchInput {
  type: MovementType;
  location?: Location | null;
  items: { variantId: string; quantity?: number; counted?: number }[];
  date?: string;
  note?: string;
}

export interface BatchResult {
  movements: Movement[];
  changes: { variantId: string; before: Stock; after: Stock }[];
}

export interface RecordResult {
  movement: Movement;
  before: Stock;
  after: Stock;
}

export interface MovementInput {
  variantId: string;
  type: MovementType;
  quantity?: number;
  counted?: number;
  location?: Location | null;
  note?: string;
  date?: string;
}

export interface VariantForm {
  code: string;
  attributes: Attribute[];
  initialOwn?: number;
  initialUzum?: number;
}

export interface ProductForm {
  name: string;
  lowStockThreshold: number;
}

export interface SyncReport {
  catalogSkus: number;
  linked: number;
  documents: number;
  changes: Record<UzumEventStatus, number>;
}

export type CatalogSku = UzumSku & { variantId: string | null };

/** Uzum holati joriy do'kon uchun: shopLinked — bu do'kon Uzumdagi do'kon bilan bog'langanmi. */
export type UzumShopStatus = UzumStatus & { shopLinked: boolean };

const id = (s: string) => encodeURIComponent(s);

export const api = {
  me: () => request<{ user: User }>('GET', '/auth/me'),
  login: (login: string, password: string) => request<{ user: User }>('POST', '/auth/login', { login, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  shops: () => request<{ shops: ShopWithStats[]; current: string }>('GET', '/shops'),
  renameShop: (shopId: string, name: string) => request<{ shop: ShopWithStats }>('PATCH', `/shops/${id(shopId)}`, { name }),

  overview: () => request<Overview>('GET', '/overview'),

  products: (includeArchived = false) =>
    request<{ products: ProductWithStock[] }>('GET', `/products${includeArchived ? '?archived=1' : ''}`),
  product: (productId: string) => request<{ product: ProductWithStock }>('GET', `/products/${id(productId)}`),
  createProduct: (input: ProductForm & { variants: VariantForm[] }) =>
    request<{ product: ProductWithStock }>('POST', '/products', input),
  updateProduct: (productId: string, patch: Partial<ProductForm & { archived: boolean }>) =>
    request<{ product: ProductWithStock }>('PATCH', `/products/${id(productId)}`, patch),
  addVariant: (productId: string, input: VariantForm) =>
    request<{ product: ProductWithStock }>('POST', `/products/${id(productId)}/variants`, input),
  updateVariant: (variantId: string, patch: Partial<{ code: string; attributes: Attribute[]; archived: boolean }>) =>
    request<{ product: ProductWithStock }>('PATCH', `/variants/${id(variantId)}`, patch),

  movements: (q: { productId?: string; variantId?: string; type?: MovementType | ''; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (q.productId) params.set('productId', q.productId);
    if (q.variantId) params.set('variantId', q.variantId);
    if (q.type) params.set('type', q.type);
    if (q.limit) params.set('limit', String(q.limit));
    if (q.offset) params.set('offset', String(q.offset));
    return request<{ movements: Movement[]; hasMore: boolean }>('GET', `/movements?${params}`);
  },
  recordMovement: (input: MovementInput) => request<RecordResult>('POST', '/movements', input),
  voidMovement: (movementId: string) => request<RecordResult>('POST', `/movements/${id(movementId)}/void`),
  recordBatch: (input: BatchInput) => request<BatchResult>('POST', '/movements/batch', input),
  voidBatch: (ids: string[]) => request<{ voided: number }>('POST', '/movements/void', { ids }),

  uzumStatus: () => request<UzumShopStatus>('GET', '/uzum/status'),
  uzumSync: () => request<{ report: SyncReport; status: UzumShopStatus }>('POST', '/uzum/sync'),
  uzumSetSyncFrom: (date: string) => request<UzumShopStatus>('PUT', '/uzum/sync-from', { date }),
  uzumEvents: (statuses?: UzumEventStatus[], limit?: number) =>
    request<{ events: UzumEvent[] }>(
      'GET',
      `/uzum/events?${new URLSearchParams({ ...(statuses ? { status: statuses.join(',') } : {}), ...(limit ? { limit: String(limit) } : {}) })}`,
    ),
  uzumCatalog: () => request<{ skus: CatalogSku[] }>('GET', '/uzum/catalog'),
  uzumLink: (uzumSkuId: number, variantId: string | null) => request<{ ok: true }>('POST', '/uzum/link', { uzumSkuId, variantId }),
  uzumImport: (uzumProductIds?: number[]) =>
    request<{ products: number; variants: number }>('POST', '/uzum/import', { uzumProductIds }),
};
