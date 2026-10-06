// Postgres adapteri (Netlify DB / Neon yoki istalgan Postgres). Ilovaning qolgan qismi o'zgarmaydi —
// faqat `Repository` interfeysi amalga oshiriladi. Drayver alohida: serverda `pg`, testlarda PGlite.
import { randomUUID } from 'node:crypto';
import {
  normalizeCode,
  type Attribute,
  type Movement,
  type Product,
  type Shop,
  type UzumEvent,
  type UzumEventStatus,
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

/** Minimal SQL mijozi: `pg` Pool/Client ham, PGlite ham shunga mos keladi. */
export interface SqlClient {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Drayver: oddiy so'rovlar va tranzaksiya (BEGIN … COMMIT bitta ulanishda). */
export interface PgDriver extends SqlClient {
  transaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

type Row = Record<string, unknown>;

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  uzum_shop_id BIGINT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shops_uzum ON shops(uzum_shop_id) WHERE uzum_shop_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  uzum_product_id BIGINT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_shop ON products(shop_id);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  shop_id TEXT NOT NULL,
  code TEXT,
  code_norm TEXT,
  attributes JSONB NOT NULL DEFAULT '[]',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  uzum_sku_id BIGINT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS variants_product ON variants(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS variants_code ON variants(shop_id, code_norm) WHERE code_norm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS variants_uzum ON variants(uzum_sku_id) WHERE uzum_sku_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants(id),
  type TEXT NOT NULL CHECK (type IN ('received','to_uzum','sold','returned','written_off','adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  location TEXT CHECK (location IN ('own','uzum')),
  direction TEXT CHECK (direction IN ('increase','decrease')),
  counted_quantity INTEGER,
  note TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','uzum')),
  source_label TEXT
);
CREATE INDEX IF NOT EXISTS movements_variant ON movements(variant_id);
CREATE INDEX IF NOT EXISTS movements_order ON movements(date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS uzum_skus (
  sku_id BIGINT PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_title TEXT NOT NULL,
  sku_title TEXT NOT NULL,
  article TEXT,
  seller_sku_code TEXT,
  barcode TEXT,
  characteristics TEXT,
  image TEXT,
  quantity_active INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uzum_events (
  id TEXT PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('to_uzum','sold','returned')),
  uzum_shop_id BIGINT,
  location TEXT CHECK (location IN ('own')),
  uzum_sku_id BIGINT,
  sku_title TEXT,
  seller_sku_code TEXT,
  product_title TEXT,
  quantity INTEGER NOT NULL,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied','pending','unmatched','cancelled','ignored')),
  reason TEXT,
  variant_id TEXT,
  movement_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS uzum_events_status ON uzum_events(status);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toShop(r: Row): Shop {
  return {
    id: String(r.id),
    name: String(r.name),
    uzumShopId: numOrNull(r.uzum_shop_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toProduct(r: Row): Product {
  return {
    id: String(r.id),
    shopId: String(r.shop_id),
    name: String(r.name),
    lowStockThreshold: Number(r.low_stock_threshold),
    archived: r.archived === true,
    uzumProductId: numOrNull(r.uzum_product_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toVariant(r: Row): Variant {
  const attrs = typeof r.attributes === 'string' ? JSON.parse(r.attributes) : r.attributes;
  return {
    id: String(r.id),
    productId: String(r.product_id),
    code: str(r.code),
    attributes: (attrs ?? []) as Attribute[],
    archived: r.archived === true,
    uzumSkuId: numOrNull(r.uzum_sku_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toMovement(r: Row): Movement {
  return {
    id: String(r.id),
    variantId: String(r.variant_id),
    type: r.type as Movement['type'],
    quantity: Number(r.quantity),
    location: str(r.location) as Movement['location'],
    direction: str(r.direction) as Movement['direction'],
    countedQuantity: numOrNull(r.counted_quantity),
    note: str(r.note),
    date: String(r.date),
    createdAt: String(r.created_at),
    voidedAt: str(r.voided_at),
    source: r.source as Movement['source'],
    sourceLabel: str(r.source_label),
  };
}

function toUzumSku(r: Row): UzumSku {
  return {
    skuId: Number(r.sku_id),
    shopId: Number(r.shop_id),
    productId: Number(r.product_id),
    productTitle: String(r.product_title),
    skuTitle: String(r.sku_title),
    article: str(r.article),
    sellerSkuCode: str(r.seller_sku_code),
    barcode: str(r.barcode),
    characteristics: str(r.characteristics),
    image: str(r.image),
    quantityActive: Number(r.quantity_active),
    archived: r.archived === true,
    updatedAt: String(r.updated_at),
  };
}

function toUzumEvent(r: Row): UzumEvent {
  return {
    id: String(r.id),
    externalRef: String(r.external_ref),
    kind: r.kind as UzumEvent['kind'],
    uzumShopId: numOrNull(r.uzum_shop_id),
    location: r.location === 'own' ? 'own' : null,
    uzumSkuId: numOrNull(r.uzum_sku_id),
    skuTitle: str(r.sku_title),
    sellerSkuCode: str(r.seller_sku_code),
    productTitle: str(r.product_title),
    quantity: Number(r.quantity),
    date: String(r.date),
    label: String(r.label),
    status: r.status as UzumEventStatus,
    reason: str(r.reason),
    variantId: str(r.variant_id),
    movementId: str(r.movement_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** $1, $2 ... belgilari bilan WHERE yasovchi. */
class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
  list(vs: unknown[]): string {
    return vs.map((v) => this.add(v)).join(',');
  }
}

const COLUMN: Record<string, string> = {
  name: 'name',
  lowStockThreshold: 'low_stock_threshold',
  uzumProductId: 'uzum_product_id',
  archived: 'archived',
  uzumShopId: 'uzum_shop_id',
  code: 'code',
  attributes: 'attributes',
  uzumSkuId: 'uzum_sku_id',
};

export class PostgresRepository implements Repository {
  private migrated: Promise<void> | null = null;

  /** `client` — tranzaksiya ichida bog'langan mijoz; tashqarida — drayverning o'zi. */
  constructor(
    private readonly driver: PgDriver,
    private readonly client: SqlClient = driver,
    private readonly inTx = false,
  ) {}

  /** Jadvallarni yaratadi (bir marta). Birinchi so'rovdan oldin avtomatik chaqiriladi. */
  async migrate(): Promise<void> {
    if (this.inTx) return;
    this.migrated ??= (async () => {
      await this.driver.transaction(async (c) => {
        // Bir vaqtda ishga tushgan bir nechta funksiya bir-biriga xalaqit bermasin.
        await c.query('SELECT pg_advisory_xact_lock(7710001)');
        for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
        await c.query(`INSERT INTO settings (key, value) VALUES ('schema.version', $1) ON CONFLICT (key) DO NOTHING`, [String(SCHEMA_VERSION)]);
      });
    })().catch((err) => {
      this.migrated = null;
      throw err;
    });
    return this.migrated;
  }

  private async q(sql: string, params: unknown[] = []): Promise<Row[]> {
    await this.migrate();
    return (await this.client.query<Row>(sql, params)).rows;
  }

  private async one(sql: string, params: unknown[] = []): Promise<Row | undefined> {
    return (await this.q(sql, params))[0];
  }

  private now(): string {
    return new Date().toISOString();
  }

  private async update(table: string, id: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
    const p = new Params();
    const sets: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !COLUMN[key]) continue;
      sets.push(`${COLUMN[key]} = ${p.add(key === 'attributes' ? JSON.stringify(value) : value)}`);
    }
    for (const [col, value] of Object.entries(extra)) sets.push(`${col} = ${p.add(value)}`);
    if (sets.length === 0) return;
    sets.push(`updated_at = ${p.add(this.now())}`);
    await this.q(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ${p.add(id)}`, p.values);
  }

  // ---------- Do'konlar ----------

  async listShops(): Promise<Shop[]> {
    return (await this.q('SELECT * FROM shops ORDER BY created_at, id')).map(toShop);
  }

  async getShop(id: string): Promise<Shop | null> {
    const r = await this.one('SELECT * FROM shops WHERE id = $1', [id]);
    return r ? toShop(r) : null;
  }

  async findShopByUzumId(uzumShopId: number): Promise<Shop | null> {
    const r = await this.one('SELECT * FROM shops WHERE uzum_shop_id = $1', [uzumShopId]);
    return r ? toShop(r) : null;
  }

  async createShop(input: NewShop): Promise<Shop> {
    const id = randomUUID();
    const now = this.now();
    await this.q('INSERT INTO shops (id, name, uzum_shop_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
      id,
      input.name,
      input.uzumShopId ?? null,
      now,
      now,
    ]);
    return (await this.getShop(id))!;
  }

  async updateShop(id: string, patch: Partial<NewShop>): Promise<Shop | null> {
    await this.update('shops', id, patch);
    return this.getShop(id);
  }

  // ---------- Kartochkalar ----------

  async listProducts(filter: ArchivedFilter = {}): Promise<Product[]> {
    const p = new Params();
    const where: string[] = [];
    if (!filter.includeArchived) where.push('archived = FALSE');
    if (filter.shopId) where.push(`shop_id = ${p.add(filter.shopId)}`);
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(name), id`;
    return (await this.q(sql, p.values)).map(toProduct);
  }

  async getProduct(id: string): Promise<Product | null> {
    const r = await this.one('SELECT * FROM products WHERE id = $1', [id]);
    return r ? toProduct(r) : null;
  }

  async createProduct(input: NewProduct): Promise<Product> {
    const id = randomUUID();
    const now = this.now();
    await this.q(
      `INSERT INTO products (id, shop_id, name, low_stock_threshold, archived, uzum_product_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7)`,
      [id, input.shopId, input.name, input.lowStockThreshold, input.uzumProductId ?? null, now, now],
    );
    return (await this.getProduct(id))!;
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<Product | null> {
    await this.update('products', id, patch as Record<string, unknown>);
    return this.getProduct(id);
  }

  // ---------- Variantlar ----------

  async listVariants(filter: ArchivedFilter & { productId?: string } = {}): Promise<Variant[]> {
    const p = new Params();
    const where: string[] = [];
    if (!filter.includeArchived) where.push('archived = FALSE');
    if (filter.productId) where.push(`product_id = ${p.add(filter.productId)}`);
    if (filter.shopId) where.push(`shop_id = ${p.add(filter.shopId)}`);
    const sql = `SELECT * FROM variants ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
    return (await this.q(sql, p.values)).map(toVariant);
  }

  async getVariant(id: string): Promise<Variant | null> {
    const r = await this.one('SELECT * FROM variants WHERE id = $1', [id]);
    return r ? toVariant(r) : null;
  }

  async findVariantByCode(shopId: string, code: string): Promise<Variant | null> {
    const norm = normalizeCode(code);
    if (!norm) return null;
    const r = await this.one('SELECT * FROM variants WHERE shop_id = $1 AND code_norm = $2', [shopId, norm]);
    return r ? toVariant(r) : null;
  }

  async findVariantByUzumSku(skuId: number): Promise<Variant | null> {
    const r = await this.one('SELECT * FROM variants WHERE uzum_sku_id = $1', [skuId]);
    return r ? toVariant(r) : null;
  }

  async createVariant(input: NewVariant): Promise<Variant> {
    const product = await this.getProduct(input.productId);
    if (!product) throw new Error(`Unknown product ${input.productId}`);
    const id = randomUUID();
    const now = this.now();
    await this.q(
      `INSERT INTO variants (id, product_id, shop_id, code, code_norm, attributes, archived, uzum_sku_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, $9)`,
      [
        id,
        input.productId,
        product.shopId,
        input.code,
        normalizeCode(input.code) || null,
        JSON.stringify(input.attributes),
        input.uzumSkuId ?? null,
        now,
        now,
      ],
    );
    return (await this.getVariant(id))!;
  }

  async updateVariant(id: string, patch: VariantPatch): Promise<Variant | null> {
    const extra = patch.code !== undefined ? { code_norm: normalizeCode(patch.code) || null } : {};
    await this.update('variants', id, patch as Record<string, unknown>, extra);
    return this.getVariant(id);
  }

  // ---------- Harakatlar ----------

  async listMovements(filter: MovementFilter = {}): Promise<Movement[]> {
    const p = new Params();
    const where: string[] = [];
    if (filter.variantIds) {
      if (filter.variantIds.length === 0) return [];
      where.push(`variant_id = ANY(${p.add(filter.variantIds)})`);
    }
    if (filter.types?.length) where.push(`type = ANY(${p.add(filter.types)})`);
    if (filter.includeVoided === false) where.push('voided_at IS NULL');
    let sql = `SELECT * FROM movements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC`;
    if (filter.limit !== undefined) sql += ` LIMIT ${p.add(filter.limit)} OFFSET ${p.add(filter.offset ?? 0)}`;
    return (await this.q(sql, p.values)).map(toMovement);
  }

  async getMovement(id: string): Promise<Movement | null> {
    const r = await this.one('SELECT * FROM movements WHERE id = $1', [id]);
    return r ? toMovement(r) : null;
  }

  async insertMovement(input: NewMovement): Promise<Movement> {
    const id = randomUUID();
    await this.q(
      `INSERT INTO movements (id, variant_id, type, quantity, location, direction, counted_quantity, note, date, created_at, voided_at, source, source_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12)`,
      [
        id,
        input.variantId,
        input.type,
        input.quantity,
        input.location,
        input.direction,
        input.countedQuantity,
        input.note,
        input.date,
        this.now(),
        input.source ?? 'manual',
        input.sourceLabel ?? null,
      ],
    );
    return (await this.getMovement(id))!;
  }

  async voidMovement(id: string, voidedAt: string): Promise<Movement | null> {
    await this.q('UPDATE movements SET voided_at = $1 WHERE id = $2 AND voided_at IS NULL', [voidedAt, id]);
    return this.getMovement(id);
  }

  // ---------- Uzum ----------

  async replaceUzumSkus(skus: UzumSku[]): Promise<void> {
    await this.q('DELETE FROM uzum_skus');
    // Bo'laklab yoziladi — yuzlab SKU bitta so'rovda.
    for (let i = 0; i < skus.length; i += 200) {
      const p = new Params();
      const rows = skus.slice(i, i + 200).map(
        (s) =>
          `(${p.list([
            s.skuId,
            s.shopId,
            s.productId,
            s.productTitle,
            s.skuTitle,
            s.article,
            s.sellerSkuCode,
            s.barcode,
            s.characteristics,
            s.image,
            s.quantityActive,
            s.archived,
            s.updatedAt,
          ])})`,
      );
      await this.q(
        `INSERT INTO uzum_skus (sku_id, shop_id, product_id, product_title, sku_title, article, seller_sku_code, barcode, characteristics, image, quantity_active, archived, updated_at)
         VALUES ${rows.join(',')}`,
        p.values,
      );
    }
  }

  async listUzumSkus(): Promise<UzumSku[]> {
    return (await this.q('SELECT * FROM uzum_skus ORDER BY product_title, sku_title')).map(toUzumSku);
  }

  async getUzumEvent(externalRef: string): Promise<UzumEvent | null> {
    const r = await this.one('SELECT * FROM uzum_events WHERE external_ref = $1', [externalRef]);
    return r ? toUzumEvent(r) : null;
  }

  async listUzumEvents(filter: UzumEventFilter = {}): Promise<UzumEvent[]> {
    const p = new Params();
    const where: string[] = [];
    if (filter.statuses?.length) where.push(`status = ANY(${p.add(filter.statuses)})`);
    if (filter.variantId) where.push(`variant_id = ${p.add(filter.variantId)}`);
    if (filter.uzumShopId !== undefined) where.push(`uzum_shop_id = ${p.add(filter.uzumShopId)}`);
    let sql = `SELECT * FROM uzum_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC`;
    if (filter.limit !== undefined) sql += ` LIMIT ${p.add(filter.limit)}`;
    return (await this.q(sql, p.values)).map(toUzumEvent);
  }

  async saveUzumEvent(input: UzumEventInput): Promise<UzumEvent> {
    const now = this.now();
    await this.q(
      `INSERT INTO uzum_events (id, external_ref, kind, uzum_shop_id, location, uzum_sku_id, sku_title, seller_sku_code, product_title, quantity, date, label, status, reason, variant_id, movement_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       ON CONFLICT (external_ref) DO UPDATE SET
         kind = EXCLUDED.kind, uzum_shop_id = EXCLUDED.uzum_shop_id, location = EXCLUDED.location,
         uzum_sku_id = EXCLUDED.uzum_sku_id, sku_title = EXCLUDED.sku_title, seller_sku_code = EXCLUDED.seller_sku_code,
         product_title = EXCLUDED.product_title, quantity = EXCLUDED.quantity, date = EXCLUDED.date, label = EXCLUDED.label,
         status = EXCLUDED.status, reason = EXCLUDED.reason, variant_id = EXCLUDED.variant_id,
         movement_id = EXCLUDED.movement_id, updated_at = EXCLUDED.updated_at`,
      [
        randomUUID(),
        input.externalRef,
        input.kind,
        input.uzumShopId,
        input.location,
        input.uzumSkuId,
        input.skuTitle,
        input.sellerSkuCode,
        input.productTitle,
        input.quantity,
        input.date,
        input.label,
        input.status,
        input.reason,
        input.variantId,
        input.movementId,
        now,
      ],
    );
    return (await this.getUzumEvent(input.externalRef))!;
  }

  // ---------- Sozlamalar ----------

  async getSetting(key: string): Promise<string | null> {
    const r = await this.one('SELECT value FROM settings WHERE key = $1', [key]);
    return r ? str(r.value) : null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    await this.q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  }

  // ---------- Tranzaksiya ----------

  async transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this); // ichma-ich — o'sha tranzaksiyada
    await this.migrate();
    return this.driver.transaction(async (client) => {
      // Yozuvchi tranzaksiyalar navbat bilan: tekshirish va yozish orasida boshqa so'rov aralashmaydi
      // (bir nechta Netlify funksiyasi bir vaqtda ishlasa ham qoldiq manfiy bo'lmaydi).
      await client.query('SELECT pg_advisory_xact_lock(7710002)');
      return fn(new PostgresRepository(this.driver, client, true));
    });
  }

  async close(): Promise<void> {
    await this.driver.close?.();
  }
}
