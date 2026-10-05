// Xotiradagi adapter: testlar uchun va yangi adapter yozishga eng qisqa namuna.
import { randomUUID } from 'node:crypto';
import {
  normalizeCode,
  type Movement,
  type Product,
  type Shop,
  type UzumEvent,
  type UzumSku,
  type Variant,
} from '../../../domain/index.ts';
import type {
  ArchivedFilter,
  MovementFilter,
  NewMovement,
  NewProduct,
  NewShop,
  NewVariant,
  ProductPatch,
  Repository,
  UzumEventFilter,
  UzumEventInput,
  VariantPatch,
} from '../repository.ts';

function compareMovements(a: { date: string; createdAt: string }, b: { date: string; createdAt: string }): number {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
}

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const clone = <T>(x: T): T => structuredClone(x);

interface State {
  shops: Map<string, Shop>;
  products: Map<string, Product>;
  variants: Map<string, Variant>;
  movements: Map<string, Movement>;
  uzumSkus: UzumSku[];
  uzumEvents: Map<string, UzumEvent>;
  settings: Map<string, string | null>;
}

export class MemoryRepository implements Repository {
  private s: State = {
    shops: new Map(),
    products: new Map(),
    variants: new Map(),
    movements: new Map(),
    uzumSkus: [],
    uzumEvents: new Map(),
    settings: new Map(),
  };
  private queue: Promise<unknown> = Promise.resolve();
  private lastTimestamp = 0;

  /** Har chaqiruvda o'suvchi vaqt — tartib barqaror bo'lishi uchun. */
  private now(): string {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp).toISOString();
  }

  private shopOf(variant: Pick<Variant, 'productId'>): string | undefined {
    return this.s.products.get(variant.productId)?.shopId;
  }

  /** Artikul do'kon ichida, Uzum SKU esa umuman takrorlanmas. */
  private assertUniqueVariant(id: string | null, productId: string, code: string | null | undefined, uzumSkuId: number | null | undefined) {
    const norm = normalizeCode(code);
    const shopId = this.shopOf({ productId });
    for (const v of this.s.variants.values()) {
      if (v.id === id) continue;
      if (norm && this.shopOf(v) === shopId && normalizeCode(v.code) === norm) throw new Error('UNIQUE constraint failed: variants.code_norm');
      if (uzumSkuId != null && v.uzumSkuId === uzumSkuId) throw new Error('UNIQUE constraint failed: variants.uzum_sku_id');
    }
  }

  // ---------- Do'konlar ----------

  async listShops(): Promise<Shop[]> {
    return [...this.s.shops.values()].map(clone);
  }

  async getShop(id: string): Promise<Shop | null> {
    const s = this.s.shops.get(id);
    return s ? clone(s) : null;
  }

  async findShopByUzumId(uzumShopId: number): Promise<Shop | null> {
    const s = [...this.s.shops.values()].find((x) => x.uzumShopId === uzumShopId);
    return s ? clone(s) : null;
  }

  async createShop(input: NewShop): Promise<Shop> {
    const now = this.now();
    const shop: Shop = { id: randomUUID(), name: input.name, uzumShopId: input.uzumShopId ?? null, createdAt: now, updatedAt: now };
    this.s.shops.set(shop.id, shop);
    return clone(shop);
  }

  async updateShop(id: string, patch: Partial<NewShop>): Promise<Shop | null> {
    const s = this.s.shops.get(id);
    if (!s) return null;
    const updated: Shop = { ...s, ...defined(patch), updatedAt: this.now() };
    this.s.shops.set(id, updated);
    return clone(updated);
  }

  // ---------- Kartochkalar ----------

  async listProducts(filter: ArchivedFilter = {}): Promise<Product[]> {
    return [...this.s.products.values()]
      .filter((p) => filter.includeArchived || !p.archived)
      .filter((p) => !filter.shopId || p.shopId === filter.shopId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(clone);
  }

  async getProduct(id: string): Promise<Product | null> {
    const p = this.s.products.get(id);
    return p ? clone(p) : null;
  }

  async createProduct(input: NewProduct): Promise<Product> {
    const now = this.now();
    const product: Product = {
      id: randomUUID(),
      shopId: input.shopId,
      name: input.name,
      lowStockThreshold: input.lowStockThreshold,
      uzumProductId: input.uzumProductId ?? null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    this.s.products.set(product.id, product);
    return clone(product);
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<Product | null> {
    const p = this.s.products.get(id);
    if (!p) return null;
    const updated: Product = { ...p, ...defined(patch), updatedAt: this.now() };
    this.s.products.set(id, updated);
    return clone(updated);
  }

  // ---------- Variantlar ----------

  async listVariants(filter: ArchivedFilter & { productId?: string } = {}): Promise<Variant[]> {
    return [...this.s.variants.values()]
      .filter((v) => filter.includeArchived || !v.archived)
      .filter((v) => !filter.productId || v.productId === filter.productId)
      .filter((v) => !filter.shopId || this.shopOf(v) === filter.shopId)
      .map(clone);
  }

  async getVariant(id: string): Promise<Variant | null> {
    const v = this.s.variants.get(id);
    return v ? clone(v) : null;
  }

  async findVariantByCode(shopId: string, code: string): Promise<Variant | null> {
    const norm = normalizeCode(code);
    if (!norm) return null;
    const v = [...this.s.variants.values()].find((x) => this.shopOf(x) === shopId && normalizeCode(x.code) === norm);
    return v ? clone(v) : null;
  }

  async findVariantByUzumSku(skuId: number): Promise<Variant | null> {
    const v = [...this.s.variants.values()].find((x) => x.uzumSkuId === skuId);
    return v ? clone(v) : null;
  }

  async createVariant(input: NewVariant): Promise<Variant> {
    if (!this.s.products.has(input.productId)) throw new Error(`Unknown product ${input.productId}`);
    this.assertUniqueVariant(null, input.productId, input.code, input.uzumSkuId);
    const now = this.now();
    const variant: Variant = {
      id: randomUUID(),
      productId: input.productId,
      code: input.code,
      attributes: clone(input.attributes),
      archived: false,
      uzumSkuId: input.uzumSkuId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.s.variants.set(variant.id, variant);
    return clone(variant);
  }

  async updateVariant(id: string, patch: VariantPatch): Promise<Variant | null> {
    const v = this.s.variants.get(id);
    if (!v) return null;
    this.assertUniqueVariant(id, v.productId, patch.code === undefined ? null : patch.code, patch.uzumSkuId);
    const updated: Variant = { ...v, ...clone(defined(patch)), updatedAt: this.now() };
    this.s.variants.set(id, updated);
    return clone(updated);
  }

  // ---------- Harakatlar ----------

  async listMovements(filter: MovementFilter = {}): Promise<Movement[]> {
    const ids = filter.variantIds ? new Set(filter.variantIds) : null;
    let list = [...this.s.movements.values()]
      .filter((m) => !ids || ids.has(m.variantId))
      .filter((m) => !filter.types?.length || filter.types.includes(m.type))
      .filter((m) => filter.includeVoided !== false || m.voidedAt === null)
      .sort(compareMovements);
    if (filter.limit !== undefined) {
      const offset = filter.offset ?? 0;
      list = list.slice(offset, offset + filter.limit);
    }
    return list.map(clone);
  }

  async getMovement(id: string): Promise<Movement | null> {
    const m = this.s.movements.get(id);
    return m ? clone(m) : null;
  }

  async insertMovement(input: NewMovement): Promise<Movement> {
    if (!this.s.variants.has(input.variantId)) throw new Error(`Unknown variant ${input.variantId}`);
    const movement: Movement = {
      id: randomUUID(),
      ...input,
      source: input.source ?? 'manual',
      sourceLabel: input.sourceLabel ?? null,
      createdAt: this.now(),
      voidedAt: null,
    };
    this.s.movements.set(movement.id, movement);
    return clone(movement);
  }

  async voidMovement(id: string, voidedAt: string): Promise<Movement | null> {
    const m = this.s.movements.get(id);
    if (!m) return null;
    if (m.voidedAt === null) this.s.movements.set(id, { ...m, voidedAt });
    return this.getMovement(id);
  }

  // ---------- Uzum ----------

  async replaceUzumSkus(skus: UzumSku[]): Promise<void> {
    this.s.uzumSkus = clone(skus);
  }

  async listUzumSkus(): Promise<UzumSku[]> {
    return clone(this.s.uzumSkus);
  }

  async getUzumEvent(externalRef: string): Promise<UzumEvent | null> {
    const e = this.s.uzumEvents.get(externalRef);
    return e ? clone(e) : null;
  }

  async listUzumEvents(filter: UzumEventFilter = {}): Promise<UzumEvent[]> {
    const list = [...this.s.uzumEvents.values()]
      .filter((e) => !filter.statuses?.length || filter.statuses.includes(e.status))
      .filter((e) => !filter.variantId || e.variantId === filter.variantId)
      .filter((e) => filter.uzumShopId === undefined || e.uzumShopId === filter.uzumShopId)
      .sort(compareMovements);
    return (filter.limit !== undefined ? list.slice(0, filter.limit) : list).map(clone);
  }

  async saveUzumEvent(input: UzumEventInput): Promise<UzumEvent> {
    const existing = this.s.uzumEvents.get(input.externalRef);
    const now = this.now();
    const event: UzumEvent = {
      ...input,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.s.uzumEvents.set(input.externalRef, event);
    return clone(event);
  }

  // ---------- Sozlamalar ----------

  async getSetting(key: string): Promise<string | null> {
    return this.s.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    this.s.settings.set(key, value);
  }

  // ---------- Tranzaksiya ----------

  transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
    // Xato bo'lsa, holatni qaytarish uchun nusxa olinadi.
    const run = async (): Promise<T> => {
      const snapshot = clone(this.s);
      try {
        return await fn(this.txView);
      } catch (err) {
        this.s = snapshot;
        throw err;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private readonly txView: Repository = new Proxy(this, {
    get: (target, prop, receiver) => {
      if (prop === 'transaction') return <T>(fn: (repo: Repository) => Promise<T>) => fn(receiver as Repository);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
