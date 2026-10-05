// Saqlash qatlami shartnomasi. Ilovaning qolgan qismi faqat shu interfeysni biladi.
// Yangi baza (Postgres, Supabase, ...) uchun shu interfeysni amalga oshiradigan adapter yozish kifoya.
import type {
  Attribute,
  Direction,
  Location,
  Movement,
  MovementSource,
  MovementType,
  Product,
  Shop,
  UzumEvent,
  UzumEventStatus,
  UzumSku,
  Variant,
} from '../../domain/index.ts';

export interface NewShop {
  name: string;
  uzumShopId?: number | null;
}

export interface NewProduct {
  shopId: string;
  name: string;
  lowStockThreshold: number;
  uzumProductId?: number | null;
}

export type ProductPatch = Partial<Omit<NewProduct, 'shopId'> & { archived: boolean }>;

export interface NewVariant {
  productId: string;
  code: string | null;
  attributes: Attribute[];
  uzumSkuId?: number | null;
}

export type VariantPatch = Partial<Omit<NewVariant, 'productId'> & { archived: boolean }>;

export interface NewMovement {
  variantId: string;
  type: MovementType;
  quantity: number;
  location: Location | null;
  direction: Direction | null;
  countedQuantity: number | null;
  note: string | null;
  date: string;
  source?: MovementSource;
  sourceLabel?: string | null;
}

export interface MovementFilter {
  variantIds?: string[];
  types?: MovementType[];
  /** Standart: true (tarixda bekor qilinganlar ham ko'rinadi). */
  includeVoided?: boolean;
  /** Tartib: sana bo'yicha kamayish, keyin yaratilgan vaqt bo'yicha kamayish. */
  limit?: number;
  offset?: number;
}

export interface ArchivedFilter {
  includeArchived?: boolean;
  /** Faqat shu do'konniki. */
  shopId?: string;
}

export type UzumEventInput = Omit<UzumEvent, 'id' | 'createdAt' | 'updatedAt'>;

export interface UzumEventFilter {
  statuses?: UzumEventStatus[];
  variantId?: string;
  /** Uzumdagi do'kon bo'yicha. */
  uzumShopId?: number;
  limit?: number;
}

export interface Repository {
  // Do'konlar
  listShops(): Promise<Shop[]>;
  getShop(id: string): Promise<Shop | null>;
  findShopByUzumId(uzumShopId: number): Promise<Shop | null>;
  createShop(input: NewShop): Promise<Shop>;
  updateShop(id: string, patch: Partial<NewShop>): Promise<Shop | null>;

  // Kartochkalar
  listProducts(filter?: ArchivedFilter): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  createProduct(input: NewProduct): Promise<Product>;
  updateProduct(id: string, patch: ProductPatch): Promise<Product | null>;

  // Variantlar (SKU)
  listVariants(filter?: ArchivedFilter & { productId?: string }): Promise<Variant[]>;
  getVariant(id: string): Promise<Variant | null>;
  /** Do'kon ichida artikul bo'yicha (katta-kichik harfsiz, `normalizeCode` qoidasi bilan). Artikul faqat do'kon ichida takrorlanmas. */
  findVariantByCode(shopId: string, code: string): Promise<Variant | null>;
  findVariantByUzumSku(skuId: number): Promise<Variant | null>;
  createVariant(input: NewVariant): Promise<Variant>;
  updateVariant(id: string, patch: VariantPatch): Promise<Variant | null>;

  // Harakatlar
  listMovements(filter?: MovementFilter): Promise<Movement[]>;
  getMovement(id: string): Promise<Movement | null>;
  /** Yangi yozuv qo'shadi. Yozuvlar hech qachon o'chirilmaydi va o'zgartirilmaydi. */
  insertMovement(input: NewMovement): Promise<Movement>;
  /** Yagona ruxsat etilgan o'zgarish: bekor qilingan vaqtni belgilash. */
  voidMovement(id: string, voidedAt: string): Promise<Movement | null>;

  // Uzum katalogi (oxirgi yangilashdagi holat — butunlay almashtiriladi)
  replaceUzumSkus(skus: UzumSku[]): Promise<void>;
  listUzumSkus(): Promise<UzumSku[]>;

  // Uzum hodisalari
  getUzumEvent(externalRef: string): Promise<UzumEvent | null>;
  listUzumEvents(filter?: UzumEventFilter): Promise<UzumEvent[]>;
  /** externalRef bo'yicha qo'shadi yoki yangilaydi. */
  saveUzumEvent(input: UzumEventInput): Promise<UzumEvent>;

  // Sozlamalar (kalit → qiymat)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;

  /**
   * `fn` ichidagi o'qish va yozishlar bir butun bo'lib bajariladi (tekshirish + yozish orasida
   * boshqa so'rov aralashmaydi). Xato bo'lsa, hammasi bekor qilinadi.
   */
  transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T>;

  close?(): Promise<void>;
}
