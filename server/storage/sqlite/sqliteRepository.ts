// SQLite adapteri. Node.js'ga o'rnatilgan `node:sqlite` ishlatiladi — qo'shimcha server yoki native modul kerak emas.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
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

type Row = Record<string, SQLInputValue>;
type Migration = string | ((db: DatabaseSync) => void);

const MIGRATIONS: Migration[] = [
  // 1 — MVP: mahsulot = bitta variant
  `
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    variant TEXT,
    sku TEXT,
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('received','to_uzum','sold','returned','written_off','adjustment')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    location TEXT CHECK (location IN ('own','uzum')),
    direction TEXT CHECK (direction IN ('increase','decrease')),
    counted_quantity INTEGER,
    note TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    voided_at TEXT
  );
  CREATE INDEX movements_product ON movements(product_id);
  CREATE INDEX movements_order ON movements(date DESC, created_at DESC);
  `,
  // 2 — kartochka + variantlar (SKU), Uzum sinxronlash
  `
  CREATE TABLE variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    code TEXT,
    code_norm TEXT,
    attributes TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0,
    uzum_sku_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX variants_product ON variants(product_id);
  CREATE UNIQUE INDEX variants_code ON variants(code_norm) WHERE code_norm IS NOT NULL;
  CREATE UNIQUE INDEX variants_uzum ON variants(uzum_sku_id) WHERE uzum_sku_id IS NOT NULL;

  -- Eski har bir mahsulot: kartochka + bitta variant (id bir xil — harakatlar o'z joyida qoladi).
  INSERT INTO variants (id, product_id, code, attributes, archived, created_at, updated_at)
  SELECT id, id, sku,
         CASE WHEN variant IS NULL OR trim(variant) = '' THEN '[]'
              ELSE json_array(json_object('name', 'Variant', 'value', variant)) END,
         archived, created_at, updated_at
  FROM products;

  ALTER TABLE products DROP COLUMN variant;
  ALTER TABLE products DROP COLUMN sku;
  ALTER TABLE products ADD COLUMN uzum_product_id INTEGER;

  CREATE TABLE movements_v2 (
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
  INSERT INTO movements_v2 (id, variant_id, type, quantity, location, direction, counted_quantity, note, date, created_at, voided_at)
  SELECT id, product_id, type, quantity, location, direction, counted_quantity, note, date, created_at, voided_at FROM movements;
  DROP TABLE movements;
  ALTER TABLE movements_v2 RENAME TO movements;
  CREATE INDEX movements_variant ON movements(variant_id);
  CREATE INDEX movements_order ON movements(date DESC, created_at DESC);

  CREATE TABLE uzum_skus (
    sku_id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    product_title TEXT NOT NULL,
    sku_title TEXT NOT NULL,
    article TEXT,
    seller_sku_code TEXT,
    barcode TEXT,
    characteristics TEXT,
    image TEXT,
    quantity_active INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE uzum_events (
    id TEXT PRIMARY KEY,
    external_ref TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('to_uzum','sold','returned')),
    uzum_sku_id INTEGER,
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
  CREATE INDEX uzum_events_status ON uzum_events(status);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `,
  // 2b — artikullarni JS'dagi qoida bilan normallashtirish (SQLite upper() kirill harflarini o'zgartirmaydi)
  (db) => {
    const rows = db.prepare('SELECT id, code FROM variants WHERE code IS NOT NULL').all() as Row[];
    const update = db.prepare('UPDATE variants SET code_norm = ? WHERE id = ?');
    for (const r of rows) {
      const norm = normalizeCode(String(r.code));
      update.run(norm === '' ? null : norm, String(r.id));
    }
  },
  // 3 — do'konlar: har bir do'konning hisobi alohida; artikul do'kon ichida takrorlanmas
  `
  CREATE TABLE shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    uzum_shop_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX shops_uzum ON shops(uzum_shop_id) WHERE uzum_shop_id IS NOT NULL;
  ALTER TABLE products ADD COLUMN shop_id TEXT REFERENCES shops(id);
  CREATE INDEX products_shop ON products(shop_id);
  ALTER TABLE variants ADD COLUMN shop_id TEXT;
  DROP INDEX variants_code;
  CREATE UNIQUE INDEX variants_code ON variants(shop_id, code_norm) WHERE code_norm IS NOT NULL;
  ALTER TABLE uzum_skus ADD COLUMN shop_id INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE uzum_events ADD COLUMN uzum_shop_id INTEGER;
  ALTER TABLE uzum_events ADD COLUMN location TEXT CHECK (location IN ('own'));
  -- Sotuv hodisalari kaliti o'zgardi; harakatga aylanmagan eski hodisalar keyingi yangilashda qayta olinadi.
  DELETE FROM uzum_events WHERE movement_id IS NULL;
  DELETE FROM settings WHERE key LIKE 'uzum.fp.%';
  `,
  // 3b — mavjud mahsulotlar bo'lsa, ular "Asosiy do'kon"ga o'tadi
  (db) => {
    const { n } = db.prepare('SELECT count(*) AS n FROM products').get() as { n: number };
    if (Number(n) === 0) return;
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO shops (id, name, uzum_shop_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)').run(id, "Asosiy do'kon", now, now);
    db.prepare('UPDATE products SET shop_id = ?').run(id);
    db.prepare('UPDATE variants SET shop_id = ?').run(id);
  },
];

const nullableString = (v: SQLInputValue | undefined) => (v === null || v === undefined ? null : String(v));
const nullableNumber = (v: SQLInputValue | undefined) => (v === null || v === undefined ? null : Number(v));

function toShop(r: Row): Shop {
  return {
    id: String(r.id),
    name: String(r.name),
    uzumShopId: nullableNumber(r.uzum_shop_id),
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
    archived: Number(r.archived) === 1,
    uzumProductId: nullableNumber(r.uzum_product_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toVariant(r: Row): Variant {
  return {
    id: String(r.id),
    productId: String(r.product_id),
    code: nullableString(r.code),
    attributes: JSON.parse(String(r.attributes)) as Attribute[],
    archived: Number(r.archived) === 1,
    uzumSkuId: nullableNumber(r.uzum_sku_id),
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
    location: nullableString(r.location) as Movement['location'],
    direction: nullableString(r.direction) as Movement['direction'],
    countedQuantity: nullableNumber(r.counted_quantity),
    note: nullableString(r.note),
    date: String(r.date),
    createdAt: String(r.created_at),
    voidedAt: nullableString(r.voided_at),
    source: r.source as Movement['source'],
    sourceLabel: nullableString(r.source_label),
  };
}

function toUzumSku(r: Row): UzumSku {
  return {
    skuId: Number(r.sku_id),
    shopId: Number(r.shop_id),
    productId: Number(r.product_id),
    productTitle: String(r.product_title),
    skuTitle: String(r.sku_title),
    article: nullableString(r.article),
    sellerSkuCode: nullableString(r.seller_sku_code),
    barcode: nullableString(r.barcode),
    characteristics: nullableString(r.characteristics),
    image: nullableString(r.image),
    quantityActive: Number(r.quantity_active),
    archived: Number(r.archived) === 1,
    updatedAt: String(r.updated_at),
  };
}

function toUzumEvent(r: Row): UzumEvent {
  return {
    id: String(r.id),
    externalRef: String(r.external_ref),
    kind: r.kind as UzumEvent['kind'],
    uzumShopId: nullableNumber(r.uzum_shop_id),
    location: r.location === 'own' ? 'own' : null,
    uzumSkuId: nullableNumber(r.uzum_sku_id),
    skuTitle: nullableString(r.sku_title),
    sellerSkuCode: nullableString(r.seller_sku_code),
    productTitle: nullableString(r.product_title),
    quantity: Number(r.quantity),
    date: String(r.date),
    label: String(r.label),
    status: r.status as UzumEventStatus,
    reason: nullableString(r.reason),
    variantId: nullableString(r.variant_id),
    movementId: nullableString(r.movement_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Patch'dagi aniqlangan maydonlardan "col = ?" ro'yxati. */
function buildSet(columns: Record<string, (v: unknown) => SQLInputValue>, patch: Record<string, unknown>) {
  const sets: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [key, toSql] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    sets.push(`${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)} = ?`);
    values.push(toSql(patch[key]));
  }
  return { sets, values };
}

const asIs = (v: unknown) => v as SQLInputValue;
const asBool = (v: unknown) => (v ? 1 : 0);

export class SqliteRepository implements Repository {
  private readonly db: DatabaseSync;
  /** Tranzaksiyalarni navbatga qo'yadi: bitta ulanishda bir vaqtda faqat bittasi. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = version; v < MIGRATIONS.length; v++) {
      const step = MIGRATIONS[v]!;
      this.db.exec('BEGIN');
      try {
        if (typeof step === 'string') this.db.exec(step);
        else step(this.db);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ---------- Do'konlar ----------

  async listShops(): Promise<Shop[]> {
    return (this.db.prepare('SELECT * FROM shops ORDER BY created_at, rowid').all() as Row[]).map(toShop);
  }

  async getShop(id: string): Promise<Shop | null> {
    const row = this.db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as Row | undefined;
    return row ? toShop(row) : null;
  }

  async findShopByUzumId(uzumShopId: number): Promise<Shop | null> {
    const row = this.db.prepare('SELECT * FROM shops WHERE uzum_shop_id = ?').get(uzumShopId) as Row | undefined;
    return row ? toShop(row) : null;
  }

  async createShop(input: NewShop): Promise<Shop> {
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare('INSERT INTO shops (id, name, uzum_shop_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.name, input.uzumShopId ?? null, now, now);
    return (await this.getShop(id))!;
  }

  async updateShop(id: string, patch: Partial<NewShop>): Promise<Shop | null> {
    const { sets, values } = buildSet({ name: asIs, uzumShopId: asIs }, patch as Record<string, unknown>);
    if (sets.length > 0) {
      this.db.prepare(`UPDATE shops SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
    }
    return this.getShop(id);
  }

  // ---------- Kartochkalar ----------

  async listProducts(filter: ArchivedFilter = {}): Promise<Product[]> {
    const where: string[] = [];
    const values: SQLInputValue[] = [];
    if (!filter.includeArchived) where.push('archived = 0');
    if (filter.shopId) {
      where.push('shop_id = ?');
      values.push(filter.shopId);
    }
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name COLLATE NOCASE`;
    return (this.db.prepare(sql).all(...values) as Row[]).map(toProduct);
  }

  async getProduct(id: string): Promise<Product | null> {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row | undefined;
    return row ? toProduct(row) : null;
  }

  async createProduct(input: NewProduct): Promise<Product> {
    const now = this.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO products (id, shop_id, name, low_stock_threshold, archived, uzum_product_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, input.shopId, input.name, input.lowStockThreshold, input.uzumProductId ?? null, now, now);
    return (await this.getProduct(id))!;
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<Product | null> {
    const { sets, values } = buildSet(
      { name: asIs, lowStockThreshold: asIs, uzumProductId: asIs, archived: asBool },
      patch as Record<string, unknown>,
    );
    if (sets.length > 0) {
      this.db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
    }
    return this.getProduct(id);
  }

  // ---------- Variantlar ----------

  async listVariants(filter: ArchivedFilter & { productId?: string } = {}): Promise<Variant[]> {
    const where: string[] = [];
    const values: SQLInputValue[] = [];
    if (!filter.includeArchived) where.push('archived = 0');
    if (filter.productId) {
      where.push('product_id = ?');
      values.push(filter.productId);
    }
    if (filter.shopId) {
      where.push('shop_id = ?');
      values.push(filter.shopId);
    }
    const sql = `SELECT * FROM variants ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, rowid`;
    return (this.db.prepare(sql).all(...values) as Row[]).map(toVariant);
  }

  async getVariant(id: string): Promise<Variant | null> {
    const row = this.db.prepare('SELECT * FROM variants WHERE id = ?').get(id) as Row | undefined;
    return row ? toVariant(row) : null;
  }

  async findVariantByCode(shopId: string, code: string): Promise<Variant | null> {
    const norm = normalizeCode(code);
    if (!norm) return null;
    const row = this.db.prepare('SELECT * FROM variants WHERE shop_id = ? AND code_norm = ?').get(shopId, norm) as Row | undefined;
    return row ? toVariant(row) : null;
  }

  async findVariantByUzumSku(skuId: number): Promise<Variant | null> {
    const row = this.db.prepare('SELECT * FROM variants WHERE uzum_sku_id = ?').get(skuId) as Row | undefined;
    return row ? toVariant(row) : null;
  }

  async createVariant(input: NewVariant): Promise<Variant> {
    const now = this.now();
    const id = randomUUID();
    const norm = normalizeCode(input.code) || null;
    const product = this.db.prepare('SELECT shop_id FROM products WHERE id = ?').get(input.productId) as Row | undefined;
    if (!product) throw new Error(`Unknown product ${input.productId}`);
    this.db
      .prepare(
        `INSERT INTO variants (id, product_id, shop_id, code, code_norm, attributes, archived, uzum_sku_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, input.productId, product.shop_id ?? null, input.code, norm, JSON.stringify(input.attributes), input.uzumSkuId ?? null, now, now);
    return (await this.getVariant(id))!;
  }

  async updateVariant(id: string, patch: VariantPatch): Promise<Variant | null> {
    const { sets, values } = buildSet(
      { code: asIs, attributes: (v) => JSON.stringify(v), uzumSkuId: asIs, archived: asBool },
      patch as Record<string, unknown>,
    );
    if (patch.code !== undefined) {
      sets.push('code_norm = ?');
      values.push(normalizeCode(patch.code) || null);
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE variants SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
    }
    return this.getVariant(id);
  }

  // ---------- Harakatlar ----------

  async listMovements(filter: MovementFilter = {}): Promise<Movement[]> {
    const where: string[] = [];
    const values: SQLInputValue[] = [];
    if (filter.variantIds) {
      if (filter.variantIds.length === 0) return [];
      where.push(`variant_id IN (${filter.variantIds.map(() => '?').join(',')})`);
      values.push(...filter.variantIds);
    }
    if (filter.types && filter.types.length > 0) {
      where.push(`type IN (${filter.types.map(() => '?').join(',')})`);
      values.push(...filter.types);
    }
    if (filter.includeVoided === false) where.push('voided_at IS NULL');

    let sql = 'SELECT * FROM movements';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY date DESC, created_at DESC';
    if (filter.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?';
      values.push(filter.limit, filter.offset ?? 0);
    }
    return (this.db.prepare(sql).all(...values) as Row[]).map(toMovement);
  }

  async getMovement(id: string): Promise<Movement | null> {
    const row = this.db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as Row | undefined;
    return row ? toMovement(row) : null;
  }

  async insertMovement(input: NewMovement): Promise<Movement> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO movements (id, variant_id, type, quantity, location, direction, counted_quantity, note, date, created_at, voided_at, source, source_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
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
      );
    return (await this.getMovement(id))!;
  }

  async voidMovement(id: string, voidedAt: string): Promise<Movement | null> {
    this.db.prepare('UPDATE movements SET voided_at = ? WHERE id = ? AND voided_at IS NULL').run(voidedAt, id);
    return this.getMovement(id);
  }

  // ---------- Uzum ----------

  async replaceUzumSkus(skus: UzumSku[]): Promise<void> {
    this.db.prepare('DELETE FROM uzum_skus').run();
    const insert = this.db.prepare(
      `INSERT INTO uzum_skus (sku_id, shop_id, product_id, product_title, sku_title, article, seller_sku_code, barcode, characteristics, image, quantity_active, archived, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of skus) {
      insert.run(
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
        s.archived ? 1 : 0,
        s.updatedAt,
      );
    }
  }

  async listUzumSkus(): Promise<UzumSku[]> {
    return (this.db.prepare('SELECT * FROM uzum_skus ORDER BY product_title, sku_title').all() as Row[]).map(toUzumSku);
  }

  async getUzumEvent(externalRef: string): Promise<UzumEvent | null> {
    const row = this.db.prepare('SELECT * FROM uzum_events WHERE external_ref = ?').get(externalRef) as Row | undefined;
    return row ? toUzumEvent(row) : null;
  }

  async listUzumEvents(filter: UzumEventFilter = {}): Promise<UzumEvent[]> {
    const where: string[] = [];
    const values: SQLInputValue[] = [];
    if (filter.statuses?.length) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      values.push(...filter.statuses);
    }
    if (filter.variantId) {
      where.push('variant_id = ?');
      values.push(filter.variantId);
    }
    if (filter.uzumShopId !== undefined) {
      where.push('uzum_shop_id = ?');
      values.push(filter.uzumShopId);
    }
    let sql = `SELECT * FROM uzum_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC`;
    if (filter.limit !== undefined) {
      sql += ' LIMIT ?';
      values.push(filter.limit);
    }
    return (this.db.prepare(sql).all(...values) as Row[]).map(toUzumEvent);
  }

  async saveUzumEvent(input: UzumEventInput): Promise<UzumEvent> {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO uzum_events (id, external_ref, kind, uzum_shop_id, location, uzum_sku_id, sku_title, seller_sku_code, product_title, quantity, date, label, status, reason, variant_id, movement_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(external_ref) DO UPDATE SET
           kind = excluded.kind, uzum_shop_id = excluded.uzum_shop_id, location = excluded.location,
           uzum_sku_id = excluded.uzum_sku_id, sku_title = excluded.sku_title,
           seller_sku_code = excluded.seller_sku_code, product_title = excluded.product_title,
           quantity = excluded.quantity, date = excluded.date, label = excluded.label, status = excluded.status,
           reason = excluded.reason, variant_id = excluded.variant_id, movement_id = excluded.movement_id,
           updated_at = excluded.updated_at`,
      )
      .run(
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
        now,
      );
    return (await this.getUzumEvent(input.externalRef))!;
  }

  // ---------- Sozlamalar ----------

  async getSetting(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return row ? nullableString(row.value) : null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // ---------- Tranzaksiya ----------

  transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this.txView);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Tranzaksiya ichida ichma-ich `transaction` chaqirilsa, navbatsiz bajariladi. */
  private readonly txView: Repository = new Proxy(this, {
    get: (target, prop, receiver) => {
      if (prop === 'transaction') return <T>(fn: (repo: Repository) => Promise<T>) => fn(receiver as Repository);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  async close(): Promise<void> {
    this.db.close();
  }
}
