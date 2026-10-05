// Biznes oqimlari: kartochkalar, variantlar, harakatlar, qoldiq. Faqat Repository interfeysi va domain funksiyalariga tayanadi.
import {
  adjustmentFromCount,
  allowsLocation,
  checkVoid,
  computeStock,
  EMPTY_STOCK,
  formatRuleError,
  isIsoDate,
  isLowStock,
  isValidCount,
  isValidQuantity,
  MAX_QUANTITY,
  MOVEMENT_TYPES,
  needsLocation,
  normalizeCode,
  normalizeDraft,
  previewMovement,
  sumStocks,
  todayIso,
  variantLabel,
  type Attribute,
  type Location,
  type Movement,
  type MovementType,
  type Product,
  type ProductWithStock,
  type RuleError,
  type Shop,
  type ShopWithStats,
  type Stock,
  type Variant,
  type VariantWithStock,
} from '../../domain/index.ts';
import type { MovementFilter, NewMovement, Repository } from '../storage/repository.ts';

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  static rule(error: RuleError): AppError {
    return new AppError(409, error.code, formatRuleError(error));
  }
}

export interface VariantInput {
  code?: unknown;
  attributes?: unknown;
  /** Boshlang'ich qoldiq (faqat yaratishda, ixtiyoriy). */
  initialOwn?: unknown;
  initialUzum?: unknown;
}

export interface ProductInput {
  name?: unknown;
  lowStockThreshold?: unknown;
}

export interface CreateProductInput extends ProductInput {
  variants?: unknown;
}

export interface RecordMovementInput {
  variantId?: unknown;
  type?: unknown;
  /** Sanab tuzatishdan boshqa turlar uchun. */
  quantity?: unknown;
  /** Faqat sanab tuzatish uchun: sanalgan haqiqiy son. */
  counted?: unknown;
  location?: unknown;
  note?: unknown;
  date?: unknown;
}

export interface RecordResult {
  movement: Movement;
  before: Stock;
  after: Stock;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  variant: VariantWithStock;
}

export interface BatchInput {
  type?: unknown;
  location?: unknown;
  /** [{ variantId, quantity }] yoki sanab tuzatishda [{ variantId, counted }] */
  items?: unknown;
  date?: unknown;
  note?: unknown;
}

export interface BatchResult {
  movements: Movement[];
  changes: { variantId: string; before: Stock; after: Stock }[];
}

export interface MovementQuery {
  shopId?: string;
  productId?: string;
  variantId?: string;
  types?: MovementType[];
  limit?: number;
  offset?: number;
}

/** Avtomatik (Uzumdan) harakat yozish natijasi: yozilmasa — foydalanuvchiga tushunarli sabab. */
export type TryInsertResult = { ok: true; movement: Movement; after: Stock } | { ok: false; error: RuleError; before: Stock };

const DEFAULT_THRESHOLD = 10;
const MAX_TEXT = 200;
const MAX_NOTE = 500;
const MAX_VARIANTS = 200;

function bad(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw bad('INVALID_INPUT', `${field} matn bo'lishi kerak.`);
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw bad('TOO_LONG', `${field} juda uzun. ${max} belgidan qisqaroq yozing.`);
  return t === '' ? null : t;
}

function parseThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_QUANTITY) {
    throw bad('INVALID_THRESHOLD', '"Tugab qolmoqda" chegarasi 0 yoki undan katta butun son bo\'lsin.');
  }
  return n;
}

function parseInitial(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '' || value === 0) return 0;
  if (!isValidCount(value)) throw bad('INVALID_INITIAL', `${label}: 0 yoki undan katta butun son kiriting.`);
  return value;
}

function parseLocation(value: unknown): Location | null {
  return value === 'own' || value === 'uzum' ? value : null;
}

function parseAttributes(value: unknown): Attribute[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad('INVALID_ATTRIBUTES', "Xususiyatlar noto'g'ri yuborildi.");
  const seen = new Set<string>();
  const result: Attribute[] = [];
  for (const raw of value) {
    const a = raw as { name?: unknown; value?: unknown };
    const name = optionalText(a?.name, 60, 'Xususiyat nomi');
    const val = optionalText(a?.value, 100, 'Xususiyat qiymati');
    if (!name || !val) continue;
    if (seen.has(name.toLowerCase())) throw bad('DUPLICATE_ATTRIBUTE', `"${name}" xususiyati ikki marta yozilgan.`);
    seen.add(name.toLowerCase());
    result.push({ name, value: val });
  }
  return result;
}

function attributesKey(attrs: readonly Attribute[]): string {
  return attrs.map((a) => `${a.name.toLowerCase()}=${a.value.toLowerCase()}`).join('|');
}

export function describeVariant(productName: string, variant: Pick<Variant, 'attributes' | 'code'>): string {
  const label = variantLabel(variant.attributes);
  return label ? `${productName} (${label})` : productName;
}

function latest(movements: readonly Movement[]): string | null {
  let at: string | null = null;
  for (const m of movements) if (!at || m.createdAt > at) at = m.createdAt;
  return at;
}

type StockListener = (variantIds: string[]) => Promise<void>;

export class InventoryService {
  private listeners: StockListener[] = [];

  constructor(private readonly repo: Repository) {}

  /** Qoldiq o'zgarganda chaqiriladi (masalan, kutilayotgan Uzum hodisalarini qayta urinish uchun). */
  onStockChanged(listener: StockListener): void {
    this.listeners.push(listener);
  }

  /** Tinglovchilar kutiladi: javob qaytguncha bog'liq o'zgarishlar ham yozilib bo'ladi. Ularning xatosi asosiy amalni buzmaydi. */
  private async emitStockChanged(variantIds: string[]): Promise<void> {
    for (const l of this.listeners) {
      await l(variantIds).catch((err: unknown) => console.error("Qoldiq o'zgarishi tinglovchisida xato:", err));
    }
  }

  // ---------- O'qish ----------

  private async assemble(products: Product[], includeArchivedVariants: boolean, shopId?: string): Promise<ProductWithStock[]> {
    const [variants, uzumSkus] = await Promise.all([
      this.repo.listVariants({ includeArchived: includeArchivedVariants, shopId }),
      this.repo.listUzumSkus(),
    ]);
    const movements = await this.repo.listMovements({ variantIds: variants.map((v) => v.id) });
    const uzumQty = new Map(uzumSkus.map((s) => [s.skuId, s.quantityActive]));
    const movesByVariant = new Map<string, Movement[]>();
    for (const m of movements) {
      const list = movesByVariant.get(m.variantId);
      if (list) list.push(m);
      else movesByVariant.set(m.variantId, [m]);
    }
    const variantsByProduct = new Map<string, Variant[]>();
    for (const v of variants) {
      const list = variantsByProduct.get(v.productId);
      if (list) list.push(v);
      else variantsByProduct.set(v.productId, [v]);
    }

    return products.map((p) => {
      const vs: VariantWithStock[] = (variantsByProduct.get(p.id) ?? []).map((v) => {
        const moves = movesByVariant.get(v.id) ?? [];
        const stock = computeStock(moves);
        const lastMovementAt = latest(moves);
        return {
          ...v,
          stock,
          // Hali hech qachon kelmagan variant "tugab qolmoqda" emas — u shunchaki hali yo'q.
          low: !v.archived && lastMovementAt !== null && isLowStock(stock, p.lowStockThreshold),
          lastMovementAt,
          uzumReported: v.uzumSkuId !== null ? (uzumQty.get(v.uzumSkuId) ?? null) : null,
        };
      });
      const active = vs.filter((v) => !v.archived);
      const lastMovementAt = vs.reduce<string | null>(
        (at, v) => (v.lastMovementAt && (!at || v.lastMovementAt > at) ? v.lastMovementAt : at),
        null,
      );
      return {
        ...p,
        variants: vs,
        stock: active.length ? sumStocks(active.map((v) => v.stock)) : EMPTY_STOCK,
        low: active.some((v) => v.low),
        lastMovementAt,
      };
    });
  }

  // ---------- Do'konlar ----------

  /** Do'konlar ro'yxati. Hali birorta bo'lmasa — bitta "Mening do'konim" yaratiladi. */
  async listShops(): Promise<ShopWithStats[]> {
    let shops = await this.repo.listShops();
    if (shops.length === 0) {
      await this.repo.transaction(async (tx) => {
        if ((await tx.listShops()).length === 0) await tx.createShop({ name: "Mening do'konim" });
      });
      shops = await this.repo.listShops();
    }
    const products = await this.repo.listProducts();
    return shops.map((s) => ({ ...s, productCount: products.filter((p) => p.shopId === s.id).length }));
  }

  /** So'ralgan do'kon; topilmasa — birinchisi. */
  async resolveShop(id: string | null | undefined): Promise<Shop> {
    const shops = await this.listShops();
    return shops.find((s) => s.id === id) ?? shops[0]!;
  }

  async renameShop(id: string, name: unknown): Promise<Shop> {
    const clean = optionalText(name, 100, "Do'kon nomi");
    if (!clean) throw bad('NAME_REQUIRED', "Do'kon nomini yozing.");
    const shop = await this.repo.transaction((tx) => tx.updateShop(id, { name: clean }));
    if (!shop) throw new AppError(404, 'SHOP_NOT_FOUND', "Do'kon topilmadi.");
    return shop;
  }

  // ---------- Kartochkalar ----------

  async listProducts(shopId: string, opts: { includeArchived?: boolean } = {}): Promise<ProductWithStock[]> {
    const products = await this.repo.listProducts({ includeArchived: opts.includeArchived, shopId });
    return this.assemble(products, false, shopId);
  }

  async getProduct(id: string): Promise<ProductWithStock> {
    const product = await this.repo.getProduct(id);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', "Mahsulot topilmadi. Ro'yxatdan qaytadan tanlang.");
    return (await this.assemble([product], true, product.shopId))[0]!;
  }

  async overview(shopId: string): Promise<{ totals: Stock; productCount: number; variantCount: number; low: LowStockItem[] }> {
    const products = await this.listProducts(shopId);
    const low: LowStockItem[] = [];
    for (const p of products) {
      for (const v of p.variants) if (v.low) low.push({ productId: p.id, productName: p.name, variant: v });
    }
    low.sort((a, b) => a.variant.stock.total - b.variant.stock.total);
    return {
      totals: products.length ? sumStocks(products.map((p) => p.stock)) : EMPTY_STOCK,
      productCount: products.length,
      variantCount: products.reduce((n, p) => n + p.variants.length, 0),
      low,
    };
  }

  // ---------- Kartochka va variantlar ----------

  /** Artikul shu do'konning boshqa variantida band emasligini tekshiradi. */
  private async assertCodeFree(repo: Repository, shopId: string, code: string | null, exceptVariantId?: string): Promise<void> {
    if (!code) return;
    const other = await repo.findVariantByCode(shopId, code);
    if (other && other.id !== exceptVariantId) {
      const product = await repo.getProduct(other.productId);
      throw new AppError(
        409,
        'CODE_TAKEN',
        `"${code}" artikuli allaqachon bor: ${describeVariant(product?.name ?? '', other)}. Boshqa artikul yozing.`,
      );
    }
  }

  private async insertInitialStock(repo: Repository, variantId: string, initialOwn: number, initialUzum: number) {
    const date = todayIso();
    // Boshlang'ich qoldiq "sanab tuzatish" sifatida yoziladi: sotuvchi bor narsani sanab kiritadi.
    for (const [location, counted] of [['own', initialOwn], ['uzum', initialUzum]] as const) {
      if (counted > 0) {
        await repo.insertMovement({
          variantId,
          type: 'adjustment',
          quantity: counted,
          location,
          direction: 'increase',
          countedQuantity: counted,
          note: "Boshlang'ich qoldiq",
          date,
        });
      }
    }
  }

  private parseVariantInputs(value: unknown) {
    const list = Array.isArray(value) && value.length > 0 ? value : [{}];
    if (list.length > MAX_VARIANTS) throw bad('TOO_MANY_VARIANTS', `Bitta kartochkada ${MAX_VARIANTS} tadan ko'p variant bo'lmasin.`);
    const parsed = list.map((raw) => {
      const v = (raw ?? {}) as VariantInput;
      return {
        code: optionalText(v.code, MAX_TEXT, 'Artikul'),
        attributes: parseAttributes(v.attributes),
        initialOwn: parseInitial(v.initialOwn, "Omborimdagi boshlang'ich son"),
        initialUzum: parseInitial(v.initialUzum, "Uzumdagi boshlang'ich son"),
      };
    });
    const codes = new Set<string>();
    const combos = new Set<string>();
    for (const v of parsed) {
      const norm = normalizeCode(v.code);
      if (norm) {
        if (codes.has(norm)) throw bad('DUPLICATE_CODE', `"${v.code}" artikuli ikki variantda takrorlangan. Har biriga alohida artikul yozing.`);
        codes.add(norm);
      }
      const key = attributesKey(v.attributes);
      if (combos.has(key)) {
        throw bad('DUPLICATE_VARIANT', `"${variantLabel(v.attributes) || 'Asosiy'}" varianti ikki marta yozilgan.`);
      }
      combos.add(key);
    }
    return parsed;
  }

  async createProduct(shopId: string, input: CreateProductInput & { uzumProductId?: number | null }): Promise<ProductWithStock> {
    const name = optionalText(input.name, MAX_TEXT, 'Nom');
    if (!name) throw bad('NAME_REQUIRED', 'Mahsulot nomini yozing.');
    const lowStockThreshold = parseThreshold(input.lowStockThreshold) ?? DEFAULT_THRESHOLD;
    const variants = this.parseVariantInputs(input.variants);

    const id = await this.repo.transaction(async (tx) => {
      if (!(await tx.getShop(shopId))) throw new AppError(404, 'SHOP_NOT_FOUND', "Do'kon topilmadi. Sahifani yangilang.");
      for (const v of variants) await this.assertCodeFree(tx, shopId, v.code);
      const product = await tx.createProduct({ shopId, name, lowStockThreshold, uzumProductId: input.uzumProductId ?? null });
      for (const v of variants) {
        const variant = await tx.createVariant({ productId: product.id, code: v.code, attributes: v.attributes });
        await this.insertInitialStock(tx, variant.id, v.initialOwn, v.initialUzum);
      }
      return product.id;
    });
    return this.getProduct(id);
  }

  async updateProduct(id: string, input: ProductInput & { archived?: unknown }): Promise<ProductWithStock> {
    const patch: Parameters<Repository['updateProduct']>[1] = {};
    if (input.name !== undefined) {
      const name = optionalText(input.name, MAX_TEXT, 'Nom');
      if (!name) throw bad('NAME_REQUIRED', 'Mahsulot nomini yozing.');
      patch.name = name;
    }
    const threshold = parseThreshold(input.lowStockThreshold);
    if (threshold !== undefined) patch.lowStockThreshold = threshold;
    if (input.archived !== undefined) patch.archived = input.archived === true;

    const updated = await this.repo.transaction((tx) => tx.updateProduct(id, patch));
    if (!updated) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Mahsulot topilmadi.');
    return this.getProduct(id);
  }

  async addVariant(productId: string, input: VariantInput): Promise<ProductWithStock> {
    const [v] = this.parseVariantInputs([input]);
    await this.repo.transaction(async (tx) => {
      const product = await tx.getProduct(productId);
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Mahsulot topilmadi.');
      await this.assertCodeFree(tx, product.shopId, v!.code);
      const existing = await tx.listVariants({ productId, includeArchived: true });
      if (existing.some((e) => attributesKey(e.attributes) === attributesKey(v!.attributes))) {
        throw new AppError(409, 'DUPLICATE_VARIANT', `"${variantLabel(v!.attributes) || 'Asosiy'}" varianti bu kartochkada allaqachon bor.`);
      }
      const variant = await tx.createVariant({ productId, code: v!.code, attributes: v!.attributes });
      await this.insertInitialStock(tx, variant.id, v!.initialOwn, v!.initialUzum);
    });
    return this.getProduct(productId);
  }

  async updateVariant(id: string, input: { code?: unknown; attributes?: unknown; archived?: unknown }): Promise<ProductWithStock> {
    const productId = await this.repo.transaction(async (tx) => {
      const variant = await tx.getVariant(id);
      if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant topilmadi.');
      const patch: Parameters<Repository['updateVariant']>[1] = {};
      if (input.code !== undefined) {
        patch.code = optionalText(input.code, MAX_TEXT, 'Artikul');
        const product = await tx.getProduct(variant.productId);
        await this.assertCodeFree(tx, product!.shopId, patch.code, id);
      }
      if (input.attributes !== undefined) {
        patch.attributes = parseAttributes(input.attributes);
        const siblings = await tx.listVariants({ productId: variant.productId, includeArchived: true });
        if (siblings.some((s) => s.id !== id && attributesKey(s.attributes) === attributesKey(patch.attributes!))) {
          throw new AppError(409, 'DUPLICATE_VARIANT', 'Bunday variant bu kartochkada allaqachon bor.');
        }
      }
      if (input.archived !== undefined) patch.archived = input.archived === true;
      await tx.updateVariant(id, patch);
      return variant.productId;
    });
    return this.getProduct(productId);
  }

  // ---------- Harakatlar ----------

  async listMovements(q: MovementQuery): Promise<Movement[]> {
    const filter: MovementFilter = { types: q.types, limit: q.limit, offset: q.offset };
    if (q.variantId) filter.variantIds = [q.variantId];
    else if (q.productId) {
      filter.variantIds = (await this.repo.listVariants({ productId: q.productId, includeArchived: true })).map((v) => v.id);
    } else if (q.shopId) {
      filter.variantIds = (await this.repo.listVariants({ shopId: q.shopId, includeArchived: true })).map((v) => v.id);
    }
    return this.repo.listMovements(filter);
  }

  /** Bugungi (yoki berilgan kundagi) Uzumdan kelgan harakatlar xulosasi — bosh sahifa uchun. */
  async uzumToday(shopId: string, date = todayIso()): Promise<Record<'to_uzum' | 'sold_fbo' | 'sold_fbs' | 'returned', number>> {
    const variantIds = (await this.repo.listVariants({ shopId, includeArchived: true })).map((v) => v.id);
    const moves = await this.repo.listMovements({ variantIds, includeVoided: false });
    const sum = { to_uzum: 0, sold_fbo: 0, sold_fbs: 0, returned: 0 };
    for (const m of moves) {
      if (m.source !== 'uzum' || m.date !== date) continue;
      if (m.type === 'to_uzum') sum.to_uzum += m.quantity;
      else if (m.type === 'sold') sum[m.location === 'own' ? 'sold_fbs' : 'sold_fbo'] += m.quantity;
      else if (m.type === 'returned') sum.returned += m.quantity;
    }
    return sum;
  }

  /** Variant va uning kartochkasi harakat uchun ochiqmi. */
  private async loadActiveVariant(repo: Repository, variantId: string): Promise<{ variant: Variant; product: Product }> {
    const variant = await repo.getVariant(variantId);
    const product = variant ? await repo.getProduct(variant.productId) : null;
    if (!variant || !product) {
      throw new AppError(404, 'VARIANT_NOT_FOUND', "Mahsulot topilmadi. Ro'yxatdan qaytadan tanlang.");
    }
    if (product.archived || variant.archived) {
      throw new AppError(409, 'ARCHIVED', 'Bu mahsulot arxivda. Avval uni arxivdan chiqaring.');
    }
    return { variant, product };
  }

  async recordMovement(input: RecordMovementInput): Promise<RecordResult> {
    if (typeof input.variantId !== 'string') throw bad('VARIANT_REQUIRED', 'Mahsulotni tanlang.');
    if (typeof input.type !== 'string' || !MOVEMENT_TYPES.includes(input.type as MovementType)) {
      throw bad('INVALID_TYPE', 'Harakat turini tanlang.');
    }
    const type = input.type as MovementType;
    const variantId = input.variantId;
    const location = allowsLocation(type) ? parseLocation(input.location) : null;
    if (needsLocation(type) && !location) throw AppError.rule({ code: 'LOCATION_REQUIRED' });
    const note = optionalText(input.note, MAX_NOTE, 'Izoh');
    const date = input.date === undefined || input.date === null || input.date === '' ? todayIso() : input.date;
    if (!isIsoDate(date)) throw bad('INVALID_DATE', "Sanani to'g'ri tanlang.");

    const result = await this.repo.transaction(async (tx) => {
      await this.loadActiveVariant(tx, variantId);
      const before = computeStock(await tx.listMovements({ variantIds: [variantId] }));

      let draft: Omit<NewMovement, 'variantId' | 'note' | 'date'>;
      if (type === 'adjustment') {
        const adj = adjustmentFromCount(before, location!, input.counted as number);
        if (!adj.ok) throw AppError.rule(adj.error);
        draft = { type, quantity: adj.quantity, direction: adj.direction, location, countedQuantity: input.counted as number };
      } else {
        if (!isValidQuantity(input.quantity)) throw AppError.rule({ code: 'INVALID_QUANTITY' });
        draft = { type, quantity: input.quantity, direction: null, location, countedQuantity: null };
      }

      const preview = previewMovement(before, draft);
      if (!preview.ok) throw AppError.rule(preview.error);

      const movement = await tx.insertMovement({ ...draft, variantId, note, date });
      return { movement, before, after: preview.after };
    });
    await this.emitStockChanged([variantId]);
    return result;
  }

  /**
   * Bir nechta variant uchun bitta turdagi harakat — bitta saqlashda (masalan, "Mahsulot keldi": Qora M 10, Qora L 15).
   * Hammasi yoziladi yoki birortasi ham yozilmaydi. Bo'sh qatorlar va sanab tuzatishda o'zgarmaganlari o'tkaziladi.
   */
  async recordBatch(input: BatchInput): Promise<BatchResult> {
    if (typeof input.type !== 'string' || !MOVEMENT_TYPES.includes(input.type as MovementType)) {
      throw bad('INVALID_TYPE', 'Harakat turini tanlang.');
    }
    const type = input.type as MovementType;
    const location = allowsLocation(type) ? parseLocation(input.location) : null;
    if (needsLocation(type) && !location) throw AppError.rule({ code: 'LOCATION_REQUIRED' });
    const note = optionalText(input.note, MAX_NOTE, 'Izoh');
    const date = input.date === undefined || input.date === null || input.date === '' ? todayIso() : input.date;
    if (!isIsoDate(date)) throw bad('INVALID_DATE', "Sanani to'g'ri tanlang.");
    if (!Array.isArray(input.items)) throw bad('ITEMS_REQUIRED', 'Kamida bitta mahsulot sonini kiriting.');

    const rows = (input.items as { variantId?: unknown; quantity?: unknown; counted?: unknown }[])
      .filter((r) => r && typeof r.variantId === 'string')
      .filter((r) => (type === 'adjustment' ? r.counted : r.quantity) !== undefined && (type === 'adjustment' ? r.counted : r.quantity) !== null);
    if (rows.length > MAX_VARIANTS) throw bad('TOO_MANY_ITEMS', `Bir martada ${MAX_VARIANTS} tadan ko'p qator kiritib bo'lmaydi.`);

    const result = await this.repo.transaction(async (tx) => {
      const out: BatchResult = { movements: [], changes: [] };
      for (const row of rows) {
        const variantId = row.variantId as string;
        const { variant, product } = await this.loadActiveVariant(tx, variantId);
        const name = describeVariant(product.name, variant);
        const before = computeStock(await tx.listMovements({ variantIds: [variantId] }));

        let draft: Omit<NewMovement, 'variantId' | 'note' | 'date'>;
        if (type === 'adjustment') {
          const adj = adjustmentFromCount(before, location!, row.counted as number);
          if (!adj.ok) {
            if (adj.error.code === 'NO_CHANGE') continue; // sanaganda o'sha son chiqdi — yozish shart emas
            throw new AppError(409, adj.error.code, `${name}: ${formatRuleError(adj.error)}`);
          }
          draft = { type, quantity: adj.quantity, direction: adj.direction, location, countedQuantity: row.counted as number };
        } else {
          if (!isValidQuantity(row.quantity)) throw new AppError(409, 'INVALID_QUANTITY', `${name}: ${formatRuleError({ code: 'INVALID_QUANTITY' })}`);
          draft = { type, quantity: row.quantity, direction: null, location, countedQuantity: null };
        }
        const preview = previewMovement(before, draft);
        if (!preview.ok) throw new AppError(409, preview.error.code, `${name}: ${formatRuleError(preview.error)}`);
        const movement = await tx.insertMovement({ ...draft, variantId, note, date });
        out.movements.push(movement);
        out.changes.push({ variantId, before, after: preview.after });
      }
      if (out.movements.length === 0) {
        throw new AppError(
          400,
          'NOTHING_TO_SAVE',
          type === 'adjustment' ? "Sanagan sonlaringiz hisob bilan bir xil — tuzatish shart emas." : 'Kamida bitta mahsulot sonini kiriting.',
        );
      }
      return out;
    });
    await this.emitStockChanged(result.changes.map((c) => c.variantId));
    return result;
  }

  /** Bir nechta yozuvni birdan bekor qilish (masalan, "Mahsulot keldi"ni bekor qilish tugmasi). Hammasi yoki hech biri. */
  async voidBatch(ids: unknown): Promise<{ voided: number }> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
      throw bad('INVALID_INPUT', "Bekor qilinadigan yozuvlar tanlanmagan.");
    }
    const variantIds = await this.repo.transaction(async (tx) => {
      const touched: string[] = [];
      for (const id of ids as string[]) {
        const movement = await tx.getMovement(id);
        if (!movement) throw new AppError(404, 'MOVEMENT_NOT_FOUND', "Yozuv topilmadi. Sahifani yangilab ko'ring.");
        if (movement.voidedAt !== null) continue;
        const before = computeStock(await tx.listMovements({ variantIds: [movement.variantId] }));
        const check = checkVoid(before, movement);
        if (!check.ok) {
          const { variant, product } = await this.describeById(tx, movement.variantId);
          throw new AppError(409, check.error.code, `${describeVariant(product, variant)}: ${formatRuleError(check.error)}`);
        }
        await tx.voidMovement(id, new Date().toISOString());
        touched.push(movement.variantId);
      }
      return touched;
    });
    await this.emitStockChanged(variantIds);
    return { voided: variantIds.length };
  }

  private async describeById(tx: Repository, variantId: string): Promise<{ variant: Variant; product: string }> {
    const variant = (await tx.getVariant(variantId))!;
    const product = await tx.getProduct(variant.productId);
    return { variant, product: product?.name ?? '' };
  }

  /**
   * Tekshirib yozadi, lekin xato tashlamaydi — Uzumdan kelgan avtomatik harakatlar uchun.
   * Chaqiruvchi tranzaksiya ichida bo'lishi kerak.
   */
  async tryInsert(
    tx: Repository,
    input: Omit<NewMovement, 'direction' | 'countedQuantity' | 'location'> & { location?: Location | null },
  ): Promise<TryInsertResult> {
    const before = computeStock(await tx.listMovements({ variantIds: [input.variantId] }));
    const draft = normalizeDraft({ type: input.type, quantity: input.quantity, location: input.location ?? null, direction: null });
    const preview = previewMovement(before, draft);
    if (!preview.ok) return { ok: false, error: preview.error, before };
    const movement = await tx.insertMovement({ ...input, ...draft, countedQuantity: null });
    return { ok: true, movement, after: preview.after };
  }

  async voidMovement(id: string): Promise<RecordResult> {
    const result = await this.repo.transaction(async (tx) => {
      const movement = await tx.getMovement(id);
      if (!movement) throw new AppError(404, 'MOVEMENT_NOT_FOUND', "Yozuv topilmadi. Sahifani yangilab ko'ring.");
      const before = computeStock(await tx.listMovements({ variantIds: [movement.variantId] }));
      const check = checkVoid(before, movement);
      if (!check.ok) throw AppError.rule(check.error);
      const voided = await tx.voidMovement(id, new Date().toISOString());

      // Uzumdan kelgan harakatni sotuvchi bekor qilsa — keyingi yangilashda qayta yozilmasin.
      if (movement.source === 'uzum') {
        const events = await tx.listUzumEvents({ variantId: movement.variantId });
        const event = events.find((e) => e.movementId === id);
        if (event) {
          const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = event;
          await tx.saveUzumEvent({ ...rest, status: 'ignored', reason: "Siz qo'lda bekor qildingiz" });
        }
      }
      return { movement: voided!, before, after: check.after };
    });
    await this.emitStockChanged([result.movement.variantId]);
    return result;
  }
}
