// Uzum bilan sinxronlash: Uzumdagi hujjatlar (nakladnoylar, qaytarishlar, sotuvlar, FBS buyurtmalar) avtomatik harakatga aylanadi.
// Har bir hujjat qatori bitta "hodisa" (UzumEvent) — takrorlanmas kalit bilan, shuning uchun ikki marta yozilmaydi.
// Har bir Uzum do'koni ilovada alohida do'kon: kartochkalar, artikullar va qoldiq aralashmaydi.
// Qoldiq qoidalari bu yerda ham amal qiladi: yozib bo'lmasa, hodisa "kutilmoqda" bo'lib turadi va sababi saqlanadi.
import {
  applyEffect,
  checkVoid,
  computeStock,
  formatRuleError,
  movementEffect,
  normalizeCode,
  previewMovement,
  todayIso,
  variantLabel,
  type RuleError,
  type Shop,
  type Stock,
  type UzumEvent,
  type UzumEventDraft,
  type UzumEventStatus,
  type UzumSku,
  type UzumStatus,
  type Variant,
} from '../../../domain/index.ts';
import { AppError, type InventoryService } from '../../services/inventory.ts';
import type { Repository, UzumEventInput } from '../../storage/repository.ts';
import { FBS_STATUSES, UzumApiError, type RawFbsOrder, type RawInvoice, type UzumApi } from './client.ts';
import {
  candidateCodes,
  fbsOrderEvents,
  financeOrderEvents,
  invoiceEvents,
  invoiceStatus,
  mapCatalog,
  parseCharacteristics,
  parseUzumDate,
  returnEvents,
} from './mapping.ts';

const KEY = {
  syncFrom: 'uzum.syncFrom',
  lastSyncAt: 'uzum.lastSyncAt',
  lastError: 'uzum.lastError',
  fingerprint: (kind: string, id: number) => `uzum.fp.${kind}.${id}`,
  /** Keyingi bajariladigan bosqich (bosqichli yangilash uchun). */
  stage: 'uzum.stage',
  /** Yangilash qulfi: shu vaqtgacha (ms) boshqa yangilash boshlanmaydi. */
  lock: 'uzum.lockUntil',
  fbsOrderIds: 'uzum.fbsOrderIds',
  /** Oxirgi yangilashda Uzum qaytargan do'konlar (keyingi bosqichlar shu ro'yxat bilan ishlaydi). */
  shopIds: 'uzum.shopIds',
};

/** Yangilash bosqichlari tartibi. */
const STAGES = ['shops', 'catalog', 'invoices', 'returns', 'fbs', 'orders', 'reprocess'] as const;
type Stage = (typeof STAGES)[number];

const PAGE_LIMIT = 40;
const DOC_PAGE_SIZE = 50;
const PRODUCT_PAGE_SIZE = 100;
/** Sotuvlar shuncha kun orqaga qayta tekshiriladi (bekor qilish/qaytarish keyinroq bo'lishi mumkin). */
const ORDER_WINDOW_DAYS = 45;

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  catalogSkus: number;
  linked: number;
  documents: number;
  changes: Record<UzumEventStatus, number>;
  /** To'liq aylana tugadimi (vaqt cheklovi bo'lsa, bir necha chaqiruvda tugaydi). */
  done: boolean;
}

interface Catalog {
  byId: Map<number, UzumSku>;
  /** "<uzum do'kon>|<kod>" → SKU */
  byCode: Map<string, UzumSku>;
  /** Uzum do'koni → ilovadagi do'kon */
  shops: Map<number, Shop>;
}

const codeKey = (uzumShopId: number, code: string | null | undefined) => `${uzumShopId}|${normalizeCode(code)}`;

function buildCatalog(skus: UzumSku[], shops: Shop[]): Catalog {
  const byId = new Map<number, UzumSku>();
  const byCode = new Map<string, UzumSku | null>();
  for (const s of skus) {
    byId.set(s.skuId, s);
    for (const c of candidateCodes(s)) {
      const key = codeKey(s.shopId, c);
      const prev = byCode.get(key);
      byCode.set(key, prev === undefined || prev?.skuId === s.skuId ? s : null); // takror bo'lsa — noaniq
    }
  }
  return {
    byId,
    byCode: new Map([...byCode].filter((e): e is [string, UzumSku] => e[1] !== null)),
    shops: new Map(shops.filter((s) => s.uzumShopId !== null).map((s) => [s.uzumShopId!, s])),
  };
}

/** Hodisa qaysi Uzum SKU'siga tegishli (katalog bo'yicha). */
function catalogSku(d: Pick<UzumEventDraft, 'uzumSkuId' | 'uzumShopId' | 'sellerSkuCode' | 'skuTitle'>, catalog: Catalog): UzumSku | undefined {
  if (d.uzumSkuId !== null) {
    const byId = catalog.byId.get(d.uzumSkuId);
    if (byId) return byId;
  }
  if (d.uzumShopId === null) return undefined;
  for (const code of [d.sellerSkuCode, d.skuTitle]) {
    if (!code) continue;
    const sku = catalog.byCode.get(codeKey(d.uzumShopId, code));
    if (sku) return sku;
  }
  return undefined;
}

function emptyCounts(): Record<UzumEventStatus, number> {
  return { applied: 0, pending: 0, unmatched: 0, cancelled: 0, ignored: 0 };
}

function eventToDraft(e: UzumEvent): UzumEventDraft {
  return {
    externalRef: e.externalRef,
    kind: e.kind,
    uzumShopId: e.uzumShopId,
    location: e.location,
    uzumSkuId: e.uzumSkuId,
    skuTitle: e.skuTitle,
    sellerSkuCode: e.sellerSkuCode,
    productTitle: e.productTitle,
    quantity: e.quantity,
    date: e.date,
    label: e.label,
    // Bekor qilinishi kutilayotgan hodisa 0 son bilan saqlanadi.
    cancelled: e.quantity === 0,
  };
}

/** Yozib bo'lmagan hodisa uchun sotuvchiga tushunarli sabab va nima qilish kerakligi. */
function pendingReason(d: UzumEventDraft, error: RuleError, before: Stock): string {
  if (error.code !== 'NOT_ENOUGH') return formatRuleError(error);
  const fix = `"Mahsulot keldi" yoki "Sanab tuzatish"ni kiriting — shundan keyin bu avtomatik yoziladi.`;
  if (d.kind === 'to_uzum') return `Uzumga ${d.quantity} ta jo'natilgan, lekin ilovada omboringizda ${before.own} ta. ${fix}`;
  if (d.kind === 'sold' && d.location === 'own') {
    return `FBS buyurtma: omboringizdan ${d.quantity} ta jo'natiladi, lekin ilovada omboringizda ${before.own} ta. ${fix}`;
  }
  const what = d.kind === 'sold' ? 'sotilgan' : 'qaytarilgan';
  return (
    `Uzumda ${d.quantity} ta ${what}, lekin ilovada Uzumda ${before.uzum} ta ko'rinadi. ` +
    `"Sanab tuzatish" → "Uzum ombori" bilan Uzumdagi sonni kiriting — shundan keyin bu avtomatik yoziladi.`
  );
}

export class UzumSyncService {
  private running = false;

  constructor(
    private readonly repo: Repository,
    private readonly inventory: InventoryService,
    private readonly api: UzumApi | null,
    private readonly opts: { shopIds?: number[]; now?: () => Date } = {},
  ) {
    // Sotuvchi qoldiqni to'g'irlasa — shu variant bo'yicha kutilayotgan hodisalarni darhol qayta urinamiz.
    inventory.onStockChanged((variantIds) => this.retryPending(variantIds));
  }

  get configured(): boolean {
    return this.api !== null;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  // ---------- Holat ----------

  /** Ilovadagi do'kon uchun Uzum holati. */
  async status(shop?: Shop | null): Promise<UzumStatus & { shopLinked: boolean }> {
    const counts = emptyCounts();
    const filter = shop?.uzumShopId != null ? { uzumShopId: shop.uzumShopId } : {};
    if (!shop || shop.uzumShopId !== null) for (const e of await this.repo.listUzumEvents(filter)) counts[e.status] += 1;
    const shops = await this.repo.listShops();
    return {
      configured: this.configured,
      shopIds: shops.map((s) => s.uzumShopId).filter((x): x is number => x !== null),
      shopLinked: shop ? shop.uzumShopId !== null : false,
      syncFrom: await this.repo.getSetting(KEY.syncFrom),
      lastSyncAt: await this.repo.getSetting(KEY.lastSyncAt),
      lastError: await this.repo.getSetting(KEY.lastError),
      running: this.running,
      counts,
    };
  }

  async setSyncFrom(date: string): Promise<void> {
    await this.repo.setSetting(KEY.syncFrom, date);
  }

  // ---------- To'liq sinxronlash (bosqichma-bosqich) ----------

  /**
   * Uzumdan yangilash. `budgetMs` — shu chaqiruv uchun vaqt: Netlify funksiyalari vaqt bilan cheklangan, shuning uchun
   * yangilash bosqichlarga bo'lingan. Vaqt tugasa — to'xtaydi, keyingi chaqiruv to'xtagan bosqichdan davom etadi.
   * `done: true` — to'liq aylana tugadi. Lokal serverda vaqt cheklovi yo'q — hammasi bir martada.
   */
  async sync(opts: { budgetMs?: number } = {}): Promise<SyncReport> {
    const api = this.api;
    if (!api) {
      throw new AppError(503, 'UZUM_NOT_CONFIGURED', "Uzum ulanmagan. UZUM_API_KEY sozlamasini kiriting va serverni qayta ishga tushiring.");
    }
    const budget = opts.budgetMs ?? Infinity;
    const started = Date.now();
    await this.acquireLock(budget);
    this.running = true;
    const startedAt = this.now().toISOString();
    const report: SyncReport = { startedAt, finishedAt: startedAt, catalogSkus: 0, linked: 0, documents: 0, changes: emptyCounts(), done: false };
    try {
      let stage = Number((await this.repo.getSetting(KEY.stage)) ?? 0) || 0;
      if (stage >= STAGES.length) stage = 0;
      let ran = 0;
      while (stage < STAGES.length) {
        // Har chaqiruvda kamida bitta bosqich; keyingisi faqat vaqt yetarli bo'lsa.
        if (ran > 0 && Date.now() - started > budget / 2) break;
        await this.runStage(api, STAGES[stage]!, report);
        stage += 1;
        ran += 1;
        await this.repo.setSetting(KEY.stage, String(stage));
      }
      report.finishedAt = this.now().toISOString();
      if (stage >= STAGES.length) {
        report.done = true;
        await this.repo.setSetting(KEY.stage, '0');
        await this.repo.setSetting(KEY.lastSyncAt, report.finishedAt);
      }
      await this.repo.setSetting(KEY.lastError, null);
      return report;
    } catch (err) {
      const message = err instanceof UzumApiError || err instanceof AppError ? err.message : `Kutilmagan xato: ${String(err)}`;
      await this.repo.setSetting(KEY.lastError, message);
      throw err instanceof AppError ? err : new AppError(502, 'UZUM_SYNC_FAILED', message);
    } finally {
      this.running = false;
      await this.repo.setSetting(KEY.lock, null);
    }
  }

  /** Bir vaqtda faqat bitta yangilash (bir nechta server nusxasi bo'lsa ham). Qulf muddati o'tsa — bo'shaydi. */
  private async acquireLock(budget: number): Promise<void> {
    const ttl = Number.isFinite(budget) ? budget + 60_000 : 30 * 60_000;
    await this.repo.transaction(async (tx) => {
      const until = Number((await tx.getSetting(KEY.lock)) ?? 0);
      if (this.running || until > Date.now()) {
        throw new AppError(409, 'SYNC_RUNNING', "Yangilash allaqachon ketyapti. Bir ozdan keyin qarang.");
      }
      await tx.setSetting(KEY.lock, String(Date.now() + ttl));
    });
  }

  private async syncFrom(): Promise<string> {
    let syncFrom = await this.repo.getSetting(KEY.syncFrom);
    if (!syncFrom) {
      // Birinchi ulanish: shu kundan boshlab hisoblanadi (eski hujjatlar ikki marta hisoblanmasligi uchun).
      syncFrom = todayIso(this.now());
      await this.repo.setSetting(KEY.syncFrom, syncFrom);
    }
    return syncFrom;
  }

  /** Uzum'ning o'zi oxirgi marta qaytargan do'konlar ("shops" bosqichida saqlanadi). */
  private async uzumShopIds(): Promise<number[]> {
    return JSON.parse((await this.repo.getSetting(KEY.shopIds)) ?? '[]') as number[];
  }

  private async runStage(api: UzumApi, stage: Stage, report: SyncReport): Promise<void> {
    const syncFrom = await this.syncFrom();
    const track = (status: UzumEventStatus | null) => {
      if (status) report.changes[status] += 1;
    };
    const now = this.now();
    const windowStart = new Date(now.getTime() - ORDER_WINDOW_DAYS * 86_400_000);
    const dateFrom = Math.max(new Date(`${syncFrom}T00:00:00`).getTime(), windowStart.getTime());

    switch (stage) {
      // 1. Do'konlar: har bir Uzum do'koni — ilovada alohida do'kon
      case 'shops': {
        let uzumShops = await api.shops();
        if (this.opts.shopIds?.length) uzumShops = uzumShops.filter((s) => this.opts.shopIds!.includes(s.id));
        if (uzumShops.length === 0) throw new AppError(502, 'NO_SHOPS', "Uzum'da do'kon topilmadi. API kaliti to'g'ri do'konga tegishlimi?");
        await this.repo.transaction(async (tx) => {
          for (const u of uzumShops) {
            const name = u.name?.trim() || `Do'kon ${u.id}`;
            const local = await tx.findShopByUzumId(u.id);
            if (!local) await tx.createShop({ name, uzumShopId: u.id });
            else if (local.name !== name) await tx.updateShop(local.id, { name });
          }
        });
        await this.repo.setSetting(KEY.shopIds, JSON.stringify(uzumShops.map((s) => s.id)));
        return;
      }

      // 2. Katalog: SKU, to'liq kod, Uzumdagi qoldiq — har bir do'kon uchun
      case 'catalog': {
        const skus: UzumSku[] = [];
        const nowIso = now.toISOString();
        for (const shopId of await this.uzumShopIds()) {
          const cards = [];
          for (let page = 0; page < PAGE_LIMIT; page++) {
            const { productList, totalProductsAmount } = await api.productsPage(shopId, page, PRODUCT_PAGE_SIZE);
            cards.push(...productList);
            if (productList.length < PRODUCT_PAGE_SIZE) break;
            if (totalProductsAmount !== undefined && (page + 1) * PRODUCT_PAGE_SIZE >= totalProductsAmount) break;
          }
          // Bitta SKU ikki marta kelmasin (sahifalar orasida yoki do'konlar orasida).
          for (const sku of mapCatalog(cards, shopId, nowIso)) if (!skus.some((x) => x.skuId === sku.skuId)) skus.push(sku);
        }
        await this.repo.transaction((tx) => tx.replaceUzumSkus(skus));
        report.catalogSkus = skus.length;
        report.linked += await this.autoLink(skus, buildCatalog(skus, await this.repo.listShops()));
        return;
      }

      // 3. Yetkazib berish nakladnoylari (FBO) → "Uzumga jo'natdim"
      case 'invoices': {
        const catalog = await this.loadCatalog();
        const shopIds = await this.uzumShopIds();
        for (let page = 0; page < PAGE_LIMIT; page++) {
          const invoices = await api.invoicesPage(page, DOC_PAGE_SIZE);
          const inRange = invoices.filter((inv) => (parseUzumDate(inv.dateCreated) ?? '9999') >= syncFrom);
          for (const inv of inRange) {
            if (typeof inv.shopId === 'number' && !shopIds.includes(inv.shopId)) continue;
            const fp = this.invoiceFingerprint(inv);
            if ((await this.repo.getSetting(KEY.fingerprint('invoice', inv.id))) === fp) continue;
            const products = inv.productForInvoiceDto?.length
              ? inv.productForInvoiceDto
              : await api.invoiceProducts(inv.shopId ?? shopIds[0]!, inv.id);
            for (const d of invoiceEvents(inv, products)) track(await this.processDraft(d, catalog));
            await this.repo.setSetting(KEY.fingerprint('invoice', inv.id), fp);
            report.documents += 1;
          }
          if (invoices.length < DOC_PAGE_SIZE || this.allOlder(invoices.map((i) => i.dateCreated), syncFrom)) break;
        }
        return;
      }

      // 4. Qaytarish nakladnoylari (Uzum omboridan sotuvchiga) → "Qaytdi"
      case 'returns': {
        const catalog = await this.loadCatalog();
        for (let page = 0; page < PAGE_LIMIT; page++) {
          const returns = await api.returnsPage(page, DOC_PAGE_SIZE);
          for (const ret of returns) {
            const date = parseUzumDate(ret.completedDate) ?? parseUzumDate(ret.dateCreated) ?? '9999';
            if (date < syncFrom) continue;
            const fp = `${ret.status}|${ret.completedDate}|${ret.canceledDate}|${ret.returnItems?.length ?? 0}`;
            if ((await this.repo.getSetting(KEY.fingerprint('return', ret.id))) === fp) continue;
            const drafts = returnEvents(ret);
            if (drafts === null) continue; // hali yakunlanmagan
            for (const d of drafts) track(await this.processDraft(d, catalog));
            await this.repo.setSetting(KEY.fingerprint('return', ret.id), fp);
            report.documents += 1;
          }
          if (returns.length < DOC_PAGE_SIZE || this.allOlder(returns.map((r) => r.dateCreated), syncFrom)) break;
        }
        return;
      }

      // 5. FBS/DBS buyurtmalar → "Sotildi (FBS)": omborimdan
      case 'fbs': {
        const catalog = await this.loadCatalog();
        const shopIds = await this.uzumShopIds();
        const fbsOrderIds = new Set<number>();
        const fbsOrders: RawFbsOrder[] = [];
        for (const status of FBS_STATUSES) {
          for (let page = 0; page < PAGE_LIMIT; page++) {
            const orders = await api.fbsOrdersPage({ shopIds, status, dateFrom, dateTo: now.getTime(), page, size: DOC_PAGE_SIZE });
            fbsOrders.push(...orders);
            if (orders.length < DOC_PAGE_SIZE) break;
          }
        }
        for (const order of fbsOrders) {
          if (fbsOrderIds.has(order.id)) continue;
          fbsOrderIds.add(order.id);
          for (const d of fbsOrderEvents(order)) {
            if (d.date < syncFrom) continue;
            track(await this.processDraft(d, catalog));
          }
          report.documents += 1;
        }
        // Keyingi bosqich (sotuvlar ro'yxati) shu buyurtmalarni ikkinchi marta hisoblamasligi uchun.
        await this.repo.setSetting(KEY.fbsOrderIds, JSON.stringify([...fbsOrderIds]));
        return;
      }

      // 6. Sotuvlar ro'yxati → "Sotildi": Uzum omboridan (FBS buyurtmalar oldingi bosqichda hisoblangan)
      case 'orders': {
        const catalog = await this.loadCatalog();
        const shopIds = await this.uzumShopIds();
        const fbsOrderIds = new Set<number>(JSON.parse((await this.repo.getSetting(KEY.fbsOrderIds)) ?? '[]'));
        for (let page = 0; page < PAGE_LIMIT * 5; page++) {
          const { orderItems, totalElements } = await api.ordersPage({ shopIds, dateFrom, dateTo: now.getTime(), page, size: DOC_PAGE_SIZE });
          const fbo = orderItems.filter((o) => !fbsOrderIds.has(o.orderId ?? o.id));
          for (const d of financeOrderEvents(fbo)) {
            if (d.date < syncFrom) continue;
            track(await this.processDraft(d, catalog));
          }
          report.documents += orderItems.length;
          if (orderItems.length < DOC_PAGE_SIZE) break;
          if (totalElements !== undefined && (page + 1) * DOC_PAGE_SIZE >= totalElements) break;
        }
        return;
      }

      // 7. Oldin bog'lanmagan yoki kutilayotganlarni qayta urinish (katalog yangilangan bo'lishi mumkin)
      case 'reprocess': {
        for (const status of await this.reprocessStored(['unmatched', 'pending'])) track(status);
        return;
      }
    }
  }

  private invoiceFingerprint(inv: RawInvoice): string {
    const lines = (inv.productForInvoiceDto ?? []).flatMap((p) => (p.skuForInvoiceDtoList ?? []).map((s) => `${s.id}:${s.quantityToStock}`));
    return `${invoiceStatus(inv)}|${inv.totalToStock}|${lines.join(',')}`;
  }

  /** Sahifadagi hamma hujjat boshlang'ich sanadan eski va ro'yxat yangidan eskiga tartiblangan bo'lsa — keyingi sahifalar kerak emas. */
  private allOlder(dates: (string | number | null | undefined)[], syncFrom: string): boolean {
    const parsed = dates.map((d) => parseUzumDate(d));
    if (parsed.length === 0 || parsed.some((d) => d === null)) return false;
    const descending = parsed.every((d, i) => i === 0 || d! <= parsed[i - 1]!);
    return descending && parsed.every((d) => d! < syncFrom);
  }

  // ---------- Katalog bog'lash ----------

  /** Kodi mos kelgan Uzum SKU'larini o'sha do'kondagi variantlarga bog'laydi. Bog'langanlar soni. */
  private async autoLink(skus: UzumSku[], catalog: Catalog): Promise<number> {
    let linked = 0;
    for (const sku of skus) {
      const shop = catalog.shops.get(sku.shopId);
      if (!shop) continue;
      linked += await this.repo.transaction(async (tx) => {
        if (await tx.findVariantByUzumSku(sku.skuId)) return 0;
        for (const code of candidateCodes(sku)) {
          const v = await tx.findVariantByCode(shop.id, code);
          if (v && v.uzumSkuId === null) {
            await tx.updateVariant(v.id, { uzumSkuId: sku.skuId });
            return 1;
          }
        }
        return 0;
      });
    }
    return linked;
  }

  private async resolveVariant(tx: Repository, d: UzumEventDraft, catalog: Catalog): Promise<Variant | null> {
    if (d.uzumSkuId !== null) {
      const v = await tx.findVariantByUzumSku(d.uzumSkuId);
      if (v) return v;
    }
    const sku = catalogSku(d, catalog);
    if (sku) {
      const v = await tx.findVariantByUzumSku(sku.skuId);
      if (v) return v;
    }
    const uzumShopId = d.uzumShopId ?? sku?.shopId ?? null;
    const shop = uzumShopId !== null ? catalog.shops.get(uzumShopId) : undefined;
    if (!shop) return null;
    const codes = [d.sellerSkuCode, ...(sku ? candidateCodes(sku) : []), d.skuTitle].filter((c): c is string => Boolean(c));
    for (const code of codes) {
      const v = await tx.findVariantByCode(shop.id, code);
      if (!v) continue;
      if (sku && v.uzumSkuId === null) return (await tx.updateVariant(v.id, { uzumSkuId: sku.skuId }))!;
      return v;
    }
    return null;
  }

  // ---------- Hodisani qo'llash ----------

  private async processDraft(d: UzumEventDraft, catalog: Catalog): Promise<UzumEventStatus | null> {
    return this.repo.transaction(async (tx) => {
      const existing = await tx.getUzumEvent(d.externalRef);
      const nowIso = this.now().toISOString();
      const sku = catalogSku(d, catalog);
      const base = {
        externalRef: d.externalRef,
        kind: d.kind,
        uzumShopId: d.uzumShopId ?? sku?.shopId ?? existing?.uzumShopId ?? null,
        location: d.location,
        uzumSkuId: d.uzumSkuId ?? sku?.skuId ?? existing?.uzumSkuId ?? null,
        skuTitle: d.skuTitle,
        sellerSkuCode: d.sellerSkuCode,
        productTitle: d.productTitle,
        quantity: d.quantity,
        date: d.date,
        label: d.label,
      };
      const save = async (patch: Pick<UzumEventInput, 'status' | 'reason' | 'variantId' | 'movementId'> & { quantity?: number }) => {
        const unchanged =
          existing &&
          existing.status === patch.status &&
          existing.reason === patch.reason &&
          existing.variantId === patch.variantId &&
          existing.movementId === patch.movementId &&
          existing.quantity === (patch.quantity ?? base.quantity) &&
          existing.location === base.location &&
          existing.date === base.date;
        await tx.saveUzumEvent({ ...base, ...patch });
        return unchanged ? null : patch.status;
      };

      const stored = existing?.movementId ? await tx.getMovement(existing.movementId) : null;
      const live = stored && stored.voidedAt === null ? stored : null;

      // Sotuvchi qo'lda bekor qilgan — tegmaymiz.
      if (existing?.status === 'ignored' || (stored && stored.voidedAt !== null && existing?.status === 'applied')) {
        return save({
          status: 'ignored',
          reason: existing?.reason ?? "Siz qo'lda bekor qildingiz",
          variantId: existing?.variantId ?? null,
          movementId: existing?.movementId ?? null,
        });
      }

      // Uzumda bekor qilingan (yoki FBS buyurtma qaytarilgan)
      if (d.cancelled || d.quantity <= 0) {
        if (live) {
          const stock = computeStock(await tx.listMovements({ variantIds: [live.variantId] }));
          const check = checkVoid(stock, live);
          if (!check.ok) {
            return save({
              status: 'pending',
              quantity: 0,
              reason: `Uzumda bekor qilindi, lekin ilovadagi yozuvni bekor qilib bo'lmadi: ${formatRuleError(check.error)}`,
              variantId: live.variantId,
              movementId: live.id,
            });
          }
          await tx.voidMovement(live.id, nowIso);
        }
        return save({ status: 'cancelled', reason: null, variantId: existing?.variantId ?? live?.variantId ?? null, movementId: existing?.movementId ?? null });
      }

      const variant = live ? await tx.getVariant(live.variantId) : await this.resolveVariant(tx, d, catalog);
      if (!variant) {
        const code = d.sellerSkuCode ?? d.skuTitle ?? sku?.skuTitle ?? (d.uzumSkuId !== null ? `SKU ${d.uzumSkuId}` : '—');
        return save({
          status: 'unmatched',
          reason: `Ilovada "${code}" kodli mahsulot yo'q. Uzum sahifasida bog'lang yoki Uzumdan import qiling.`,
          variantId: null,
          movementId: null,
        });
      }

      const location = d.location === 'own' ? 'own' : null;

      // Oldin yozilgan: soni va joyi o'zgarmagan bo'lsa — tayyor; o'zgargan bo'lsa — eskisini bekor qilib, yangisini yozamiz.
      if (live) {
        if (live.quantity === d.quantity && (live.location ?? null) === location) {
          return save({ status: 'applied', reason: null, variantId: variant.id, movementId: live.id });
        }
        const stock = computeStock(await tx.listMovements({ variantIds: [variant.id] }));
        const withoutOld = applyEffect(stock, movementEffect(live), -1);
        const preview = previewMovement(withoutOld, { type: d.kind, quantity: d.quantity, location });
        if (!preview.ok) {
          return save({
            status: 'pending',
            reason: `Uzumda o'zgardi (${live.quantity} → ${d.quantity} ta). ${pendingReason(d, preview.error, withoutOld)}`,
            variantId: variant.id,
            movementId: live.id,
          });
        }
        await tx.voidMovement(live.id, nowIso);
        const m = await tx.insertMovement({
          variantId: variant.id,
          type: d.kind,
          quantity: d.quantity,
          location,
          direction: null,
          countedQuantity: null,
          note: live.quantity !== d.quantity ? `Uzumda soni o'zgardi: ${live.quantity} → ${d.quantity}` : null,
          date: d.date,
          source: 'uzum',
          sourceLabel: d.label,
        });
        return save({ status: 'applied', reason: null, variantId: variant.id, movementId: m.id });
      }

      const r = await this.inventory.tryInsert(tx, {
        variantId: variant.id,
        type: d.kind,
        quantity: d.quantity,
        location,
        note: null,
        date: d.date,
        source: 'uzum',
        sourceLabel: d.label,
      });
      if (!r.ok) {
        return save({ status: 'pending', reason: pendingReason(d, r.error, r.before), variantId: variant.id, movementId: null });
      }
      return save({ status: 'applied', reason: null, variantId: variant.id, movementId: r.movement.id });
    });
  }

  private async loadCatalog(): Promise<Catalog> {
    return buildCatalog(await this.repo.listUzumSkus(), await this.repo.listShops());
  }

  /** Saqlangan hodisalarni (eski sanadan boshlab) qayta qo'llaydi. */
  private async reprocessStored(statuses: UzumEventStatus[], catalog?: Catalog, variantIds?: string[]): Promise<(UzumEventStatus | null)[]> {
    let events = await this.repo.listUzumEvents({ statuses });
    if (variantIds) {
      const ids = new Set(variantIds);
      events = events.filter((e) => e.variantId !== null && ids.has(e.variantId));
    }
    if (events.length === 0) return [];
    const cat = catalog ?? (await this.loadCatalog());
    const results: (UzumEventStatus | null)[] = [];
    for (const e of events.reverse()) results.push(await this.processDraft(eventToDraft(e), cat));
    return results;
  }

  async retryPending(variantIds: string[]): Promise<void> {
    await this.reprocessStored(['pending'], undefined, variantIds);
  }

  // ---------- Sotuvchi amallari (joriy do'kon bo'yicha) ----------

  async listEvents(shop: Shop, statuses?: UzumEventStatus[], limit = 200): Promise<UzumEvent[]> {
    if (shop.uzumShopId === null) return [];
    return this.repo.listUzumEvents({ statuses, limit, uzumShopId: shop.uzumShopId });
  }

  async catalog(shop: Shop): Promise<(UzumSku & { variantId: string | null })[]> {
    if (shop.uzumShopId === null) return [];
    const skus = (await this.repo.listUzumSkus()).filter((s) => s.shopId === shop.uzumShopId);
    const variants = await this.repo.listVariants({ includeArchived: true, shopId: shop.id });
    const bySku = new Map(variants.filter((v) => v.uzumSkuId !== null).map((v) => [v.uzumSkuId!, v.id]));
    return skus.map((s) => ({ ...s, variantId: bySku.get(s.skuId) ?? null }));
  }

  /** Uzum SKU'sini ilovadagi variantga qo'lda bog'laydi (yoki bog'lanishni uzadi). Faqat bir do'kon ichida. */
  async link(uzumSkuId: number, variantId: string | null): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const sku = (await tx.listUzumSkus()).find((s) => s.skuId === uzumSkuId);
      const current = await tx.findVariantByUzumSku(uzumSkuId);
      if (current && current.id !== variantId) await tx.updateVariant(current.id, { uzumSkuId: null });
      if (variantId) {
        const v = await tx.getVariant(variantId);
        if (!v) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant topilmadi.');
        const product = await tx.getProduct(v.productId);
        const shop = product ? await tx.getShop(product.shopId) : null;
        if (sku && shop?.uzumShopId !== sku.shopId) {
          throw new AppError(409, 'OTHER_SHOP', "Bu mahsulot boshqa do'konga tegishli. Uzum mahsulotini faqat o'sha do'kondagi variantga bog'lash mumkin.");
        }
        await tx.updateVariant(variantId, { uzumSkuId });
      }
    });
    await this.reprocessStored(['unmatched', 'pending']);
  }

  /**
   * Joriy do'konning bog'lanmagan Uzum kartochkalarini ilovaga import qiladi: kartochka, variantlar (xususiyat va kod bilan)
   * va Uzumdagi hozirgi qoldiq. Bu SKU'larning import paytigacha bo'lgan hodisalari shu qoldiqqa kirgan — ular qayta yozilmaydi.
   */
  async importFromUzum(shop: Shop, uzumProductIds?: number[]): Promise<{ products: number; variants: number }> {
    if (shop.uzumShopId === null) throw new AppError(409, 'SHOP_NOT_LINKED', "Bu do'kon Uzumga bog'lanmagan.");
    const skus = (await this.repo.listUzumSkus()).filter((s) => s.shopId === shop.uzumShopId);
    const groups = new Map<number, UzumSku[]>();
    for (const s of skus) {
      if (s.archived) continue;
      if (uzumProductIds && !uzumProductIds.includes(s.productId)) continue;
      const list = groups.get(s.productId);
      if (list) list.push(s);
      else groups.set(s.productId, [s]);
    }

    const today = todayIso(this.now());
    const result = { products: 0, variants: 0 };
    const importedSkuIds: number[] = [];
    for (const [uzumProductId, list] of groups) {
      await this.repo.transaction(async (tx) => {
        const fresh: { sku: UzumSku; code: string | null }[] = [];
        for (const sku of list) {
          if (await tx.findVariantByUzumSku(sku.skuId)) continue;
          let taken = false;
          for (const c of candidateCodes(sku)) if (await tx.findVariantByCode(shop.id, c)) taken = true;
          if (taken) continue; // kodi bor variant — avtomatik bog'lanadi, import kerak emas
          fresh.push({ sku, code: sku.sellerSkuCode ?? sku.article ?? sku.skuTitle });
        }
        if (fresh.length === 0) return;

        const product = await tx.createProduct({
          shopId: shop.id,
          name: fresh[0]!.sku.productTitle || fresh[0]!.sku.skuTitle,
          lowStockThreshold: 10,
          uzumProductId,
        });
        const seen = new Set<string>();
        for (const { sku, code } of fresh) {
          let attributes = parseCharacteristics(sku.characteristics);
          if (seen.has(variantLabel(attributes).toLowerCase())) attributes = [{ name: 'Variant', value: sku.skuTitle }];
          seen.add(variantLabel(attributes).toLowerCase());
          const variant = await tx.createVariant({ productId: product.id, code, attributes, uzumSkuId: sku.skuId });
          if (sku.quantityActive > 0) {
            await tx.insertMovement({
              variantId: variant.id,
              type: 'adjustment',
              quantity: sku.quantityActive,
              location: 'uzum',
              direction: 'increase',
              countedQuantity: sku.quantityActive,
              note: "Boshlang'ich qoldiq (Uzum ma'lumoti)",
              date: today,
              source: 'uzum',
              sourceLabel: 'Uzumdan import',
            });
          }
          importedSkuIds.push(sku.skuId);
          result.variants += 1;
        }
        result.products += 1;
      });
    }

    // Import qilingan SKU'larning eski Uzum-ombori hodisalari (sotuv, jo'natish) Uzumdagi qoldiqqa allaqachon kirgan.
    // FBS sotuvlar esa omborimga tegishli — ular import qoldig'iga kirmaydi, shuning uchun qayta qo'llanadi.
    if (importedSkuIds.length) {
      const catalog = await this.loadCatalog();
      const ids = new Set(importedSkuIds);
      for (const e of await this.repo.listUzumEvents({ statuses: ['unmatched'] })) {
        const sku = catalogSku(e, catalog);
        if (!sku || !ids.has(sku.skuId) || e.location === 'own') continue;
        const variant = await this.repo.findVariantByUzumSku(sku.skuId);
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = e;
        await this.repo.saveUzumEvent({ ...rest, status: 'ignored', reason: 'Uzumdan import qilingan qoldiqqa kiritilgan', variantId: variant?.id ?? null });
      }
      await this.reprocessStored(['unmatched'], catalog);
    }
    return result;
  }
}
