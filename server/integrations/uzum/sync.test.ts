import { afterEach, describe, expect, it } from 'vitest';
import { adapters } from '../../testing.ts';
import { InventoryService } from '../../services/inventory.ts';
import type { Repository } from '../../storage/repository.ts';
import type { RawFbsOrder, RawInvoice, RawOrderItem, RawProductCard, RawReturn, UzumApi } from './client.ts';
import { invoiceEvents, mapCatalog, orderEvent, parseCharacteristics, parseUzumDate, returnEvents } from './mapping.ts';
import { UzumSyncService } from './sync.ts';

/** Xotiradagi soxta Uzum: testda hujjatlarni qo'shib, sinxronlashni tekshiramiz. */
class FakeUzum implements UzumApi {
  cards: RawProductCard[] = [];
  invoices: RawInvoice[] = [];
  returns: RawReturn[] = [];
  orders: RawOrderItem[] = [];
  fbs: RawFbsOrder[] = [];
  calls = 0;

  async shops() {
    return [{ id: 7, name: 'Do\'kon' }];
  }
  async productsPage(_shopId: number, page: number, size: number) {
    this.calls++;
    return { productList: this.cards.slice(page * size, (page + 1) * size), totalProductsAmount: this.cards.length };
  }
  async invoicesPage(page: number, size: number) {
    this.calls++;
    return this.invoices.slice(page * size, (page + 1) * size);
  }
  async invoiceProducts() {
    return [];
  }
  async returnsPage(page: number, size: number) {
    return this.returns.slice(page * size, (page + 1) * size);
  }
  async fbsOrdersPage(q: { status: string; page: number; size: number }) {
    return this.fbs.filter((o) => o.status === q.status).slice(q.page * q.size, (q.page + 1) * q.size);
  }
  async ordersPage(q: { page: number; size: number }) {
    return { orderItems: this.orders.slice(q.page * q.size, (q.page + 1) * q.size), totalElements: this.orders.length };
  }
}

const NOW = new Date('2026-10-01T12:00:00');

function card(productId: number, title: string, skus: { skuId: number; code: string; chars?: string; qty?: number }[]): RawProductCard {
  return {
    productId,
    title,
    skuList: skus.map((s) => ({
      skuId: s.skuId,
      skuTitle: s.code,
      sellerItemCode: s.code,
      article: s.code,
      characteristics: s.chars ?? null,
      quantityActive: s.qty ?? 0,
    })),
  };
}

function invoice(id: number, lines: { skuId: number; qty: number }[], status = 'CREATED', date = '2026-10-01T09:00:00'): RawInvoice {
  return {
    id,
    invoiceNumber: 1000 + id,
    dateCreated: date,
    invoiceStatus: { value: status },
    totalToStock: lines.reduce((n, l) => n + l.qty, 0),
    shopId: 7,
    productForInvoiceDto: [
      { id: 1, productTitle: 'Hoodie', skuForInvoiceDtoList: lines.map((l) => ({ id: l.skuId, skuTitle: `SKU${l.skuId}`, quantityToStock: l.qty })) },
    ],
  };
}

describe('Uzum hujjatlarini o\'qish (sof funksiyalar)', () => {
  it('sanalar turli formatda keladi', () => {
    expect(parseUzumDate('2026-09-27T10:15:00')).toBe('2026-09-27');
    expect(parseUzumDate('27.09.2026 10:15')).toBe('2026-09-27');
    expect(parseUzumDate(new Date('2026-09-27T10:15:00').getTime())).toBe('2026-09-27');
    expect(parseUzumDate(null)).toBeNull();
  });

  it('katalogda to\'liq kod skuFullTitle\'dan olinadi (skuTitle — faqat qisqa qismi)', () => {
    const [sku] = mapCatalog([
      { productId: 1, title: 'Sport kostyum', skuList: [{ skuId: 5, skuTitle: 'БЕЖЕВ-L', skuFullTitle: 'DINAMUZ-JORDAN-БЕЖЕВ-L', characteristics: 'L, Sargʻish' }] },
    ]);
    expect(sku!.skuTitle).toBe('DINAMUZ-JORDAN-БЕЖЕВ-L');
  });

  it('xususiyatlar matnidan ajratiladi', () => {
    expect(parseCharacteristics('Цвет: Бежевый, Размер одежды: L')).toEqual([
      { name: 'Цвет', value: 'Бежевый' },
      { name: 'Размер одежды', value: 'L' },
    ]);
    // Haqiqiy Uzum javobi: faqat qiymatlar, nomsiz
    expect(parseCharacteristics('L, Sargʻish')).toEqual([
      { name: 'Rang', value: 'Sargʻish' },
      { name: "O'lcham", value: 'L' },
    ]);
    expect(parseCharacteristics('Yashil, 0.5l')).toEqual([
      { name: 'Rang', value: 'Yashil' },
      { name: 'Hajm', value: '0.5l' },
    ]);
    expect(parseCharacteristics('Oq, 100')).toEqual([
      { name: 'Rang', value: 'Oq' },
      { name: "O'lcham", value: '100' },
    ]);
  });

  it('nakladnoy har bir SKU uchun alohida hodisa beradi, bekor qilingani belgilanadi', () => {
    const events = invoiceEvents(invoice(1, [{ skuId: 11, qty: 30 }, { skuId: 12, qty: 5 }], 'CANCELED'), invoice(1, [{ skuId: 11, qty: 30 }, { skuId: 12, qty: 5 }]).productForInvoiceDto!);
    expect(events.map((e) => [e.externalRef, e.quantity, e.cancelled])).toEqual([
      ['invoice:1:sku:11', 30, true],
      ['invoice:1:sku:12', 5, true],
    ]);
  });

  it('sotuvdan bekor qilingan va qaytgan sonlar ayiriladi', () => {
    expect(orderEvent({ id: 1, amount: 3, cancelled: 1, amountReturns: 1, status: 'TO_WITHDRAW', date: NOW.getTime() })).toMatchObject({ quantity: 1, cancelled: false });
    expect(orderEvent({ id: 2, amount: 1, status: 'CANCELED', date: NOW.getTime() }).cancelled).toBe(true);
  });

  it('qaytarish faqat yakunlanganda hisoblanadi, FBS o\'tkaziladi', () => {
    expect(returnEvents({ id: 1, status: 'CREATED', returnItems: [{ id: 1, skuId: 11, amount: 2 }] })).toBeNull();
    expect(returnEvents({ id: 1, status: 'COMPLETED', type: 'RETURN', returnItems: [{ id: 1, skuId: 11, amount: 2 }] })).toHaveLength(1);
    expect(returnEvents({ id: 1, status: 'COMPLETED', type: 'FBS', returnItems: [{ id: 1, skuId: 11, amount: 2 }] })).toEqual([]);
  });
});

describe.each(adapters)('Uzum sinxronlash (%s)', (_name, makeRepo) => {
  let repo: Repository;
  afterEach(async () => {
    await repo?.close?.();
  });

  async function setup() {
    repo = await makeRepo();
    const inventory = new InventoryService(repo);
    const fake = new FakeUzum();
    const uzum = new UzumSyncService(repo, inventory, fake, { now: () => NOW });
    // Ilovadagi do'kon Uzumdagi 7-do'kon bilan bog'langan.
    const shop = await repo.createShop({ name: "Do'kon", uzumShopId: 7 });
    // Sotuvchining kartochkasi: Hoodie, 2 variant, artikullar Uzumdagi bilan bir xil.
    const hoodie = await inventory.createProduct(shop.id, {
      name: 'Hoodie',
      variants: [
        { attributes: [{ name: 'Rang', value: 'Qora' }], code: 'HOODIE-QORA', initialOwn: 100 },
        { attributes: [{ name: 'Rang', value: 'Oq' }], code: 'hoodie-oq', initialOwn: 10 },
      ],
    });
    fake.cards = [card(500, 'Hoodie', [{ skuId: 11, code: 'HOODIE-QORA' }, { skuId: 12, code: 'HOODIE-OQ' }])];
    const [qora, oq] = hoodie.variants;
    const stock = async () => {
      const p = await inventory.getProduct(hoodie.id);
      return Object.fromEntries(p.variants.map((v) => [v.code, v.stock]));
    };
    return { inventory, uzum, fake, shop, qora: qora!, oq: oq!, stock };
  }

  it('Uzumda nakladnoy yaratilsa, omborimdan avtomatik ayiriladi (artikul bo\'yicha tanib olinadi)', async () => {
    const { uzum, fake, stock, inventory, qora, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }, { skuId: 12, qty: 4 }])];

    const report = await uzum.sync();
    expect(report.linked).toBe(2);
    expect(report.changes.applied).toBe(2);
    expect(await stock()).toEqual({
      'HOODIE-QORA': { own: 70, uzum: 30, total: 100 },
      'hoodie-oq': { own: 6, uzum: 4, total: 10 },
    });

    const [m] = await inventory.listMovements({ variantId: qora.id, types: ['to_uzum'] });
    expect(m).toMatchObject({ source: 'uzum', sourceLabel: 'Nakladnoy №1001', quantity: 30 });
  });

  it('qayta yangilashda ikki marta yozilmaydi', async () => {
    const { uzum, fake, stock, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    await uzum.sync();
    const second = await uzum.sync();
    expect(second.changes.applied).toBe(0);
    expect((await stock())['HOODIE-QORA']!.own).toBe(70);
  });

  it('Uzumda nakladnoy bekor qilinsa, yozuv ham bekor qilinadi (tarixda qoladi)', async () => {
    const { uzum, fake, stock, inventory, qora, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    await uzum.sync();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }], 'CANCELED')];
    const r = await uzum.sync();
    expect(r.changes.cancelled).toBe(1);
    expect((await stock())['HOODIE-QORA']!.own).toBe(100);
    const history = await inventory.listMovements({ variantId: qora.id, types: ['to_uzum'] });
    expect(history).toHaveLength(1);
    expect(history[0]!.voidedAt).not.toBeNull();
  });

  it('Uzumda son o\'zgarsa, eski yozuv bekor qilinib yangisi yoziladi', async () => {
    const { uzum, fake, stock, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    await uzum.sync();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 25 }])];
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']).toEqual({ own: 75, uzum: 25, total: 100 });
  });

  it('omborda yetarli bo\'lmasa — qoldiq manfiy bo\'lmaydi, hodisa kutadi va qoldiq to\'g\'rilangach o\'zi yoziladi', async () => {
    const { uzum, fake, stock, inventory, oq, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 12, qty: 15 }])]; // omborda 10 ta
    const r = await uzum.sync();
    expect(r.changes.pending).toBe(1);
    expect((await stock())['hoodie-oq']!.own).toBe(10);
    const [pending] = await uzum.listEvents(shop, ['pending']);
    expect(pending!.reason).toContain("omboringizda 10 ta");

    // Sotuvchi "Mahsulot keldi" kiritadi → kutilayotgan jo'natma darhol yoziladi.
    await inventory.recordMovement({ variantId: oq.id, type: 'received', quantity: 5 });
    expect((await stock())['hoodie-oq']).toEqual({ own: 0, uzum: 15, total: 15 });
    expect(await uzum.listEvents(shop, ['pending'])).toHaveLength(0);
  });

  it('artikuli mos kelmagan SKU bog\'lanmagan bo\'lib turadi; qo\'lda bog\'langach yoziladi', async () => {
    const { uzum, fake, stock, qora, shop } = await setup();
    fake.cards = [card(500, 'Hoodie', [{ skuId: 11, code: 'BOSHQA-KOD' }])];
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    const r = await uzum.sync();
    expect(r.changes.unmatched).toBe(1);
    expect((await stock())['HOODIE-QORA']!.own).toBe(100);

    await uzum.link(11, qora.id);
    expect((await stock())['HOODIE-QORA']!.own).toBe(70);
    expect(await uzum.listEvents(shop, ['unmatched'])).toHaveLength(0);
  });

  it('sotuv va yakunlangan qaytarish yoziladi', async () => {
    const { uzum, fake, stock, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    fake.orders = [{ id: 900, orderId: 77, shopId: 7, amount: 3, status: 'TO_WITHDRAW', sellerSkuCode: 'HOODIE-QORA', skuTitle: 'HOODIE-QORA', date: NOW.getTime() }];
    fake.returns = [{ id: 5, status: 'COMPLETED', type: 'RETURN', completedDate: '2026-10-01T11:00:00', returnItems: [{ id: 1, skuId: 11, amount: 2 }] }];
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']).toEqual({ own: 72, uzum: 25, total: 97 });
  });

  it('qo\'lda bekor qilingan avtomatik yozuv qayta yozilmaydi', async () => {
    const { uzum, fake, stock, inventory, qora, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    await uzum.sync();
    const [m] = await inventory.listMovements({ variantId: qora.id, types: ['to_uzum'] });
    await inventory.voidMovement(m!.id);
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']!.own).toBe(100);
    expect(await uzum.listEvents(shop, ['ignored'])).toHaveLength(1);
  });

  it('boshlang\'ich sanadan oldingi hujjatlar hisobga olinmaydi', async () => {
    const { uzum, fake, stock, shop } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }], 'ACCEPTED', '2026-09-20T09:00:00')];
    await uzum.sync(); // birinchi ulanish — syncFrom = bugun
    expect((await uzum.status(shop)).syncFrom).toBe('2026-10-01');
    expect((await stock())['HOODIE-QORA']!.own).toBe(100);
  });

  it('Uzum katalogidan import: kartochka, variantlar va Uzumdagi qoldiq', async () => {
    const { uzum, fake, inventory, shop } = await setup();
    fake.cards.push(
      card(600, "Erkaklar sport kostyumi", [
        { skuId: 21, code: 'DINAMUZ-JORDAN-БЕЖЕВ-L', chars: 'Цвет: Бежевый, Размер одежды: L', qty: 8 },
        { skuId: 22, code: 'DINAMUZ-JORDAN-БЕЖЕВ-M', chars: 'Цвет: Бежевый, Размер одежды: M', qty: 0 },
      ]),
    );
    await uzum.sync();
    const result = await uzum.importFromUzum(shop);
    expect(result).toEqual({ products: 1, variants: 2 });

    const imported = (await inventory.listProducts(shop.id)).find((p) => p.uzumProductId === 600)!;
    expect(imported.name).toBe('Erkaklar sport kostyumi');
    expect(imported.variants.map((v) => [v.code, v.attributes.map((a) => a.value).join('/'), v.stock.uzum, v.uzumSkuId])).toEqual([
      ['DINAMUZ-JORDAN-БЕЖЕВ-L', 'Бежевый/L', 8, 21],
      ['DINAMUZ-JORDAN-БЕЖЕВ-M', 'Бежевый/M', 0, 22],
    ]);
    // Ikkinchi import hech narsa qo'shmaydi.
    expect(await uzum.importFromUzum(shop)).toEqual({ products: 0, variants: 0 });
  });

  it("FBS buyurtma omborimdan ayiriladi; bekor qilinsa qaytadi; sotuvlar ro'yxatida takrorlanmaydi", async () => {
    const { uzum, fake, stock } = await setup();
    const item = { id: 1, orderId: 555, shopId: 7, amount: 2, status: 'PROCESSING', skuTitle: 'HOODIE-QORA', date: NOW.getTime() };
    fake.fbs = [{ id: 555, status: 'CREATED', scheme: 'FBS', shopId: 7, dateCreated: NOW.getTime(), orderItems: [item] }];
    fake.orders = [item]; // xuddi shu buyurtma sotuvlar ro'yxatida ham bor
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']).toEqual({ own: 98, uzum: 0, total: 98 });

    fake.fbs = [{ ...fake.fbs[0]!, status: 'CANCELED' }];
    fake.orders = [];
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']).toEqual({ own: 100, uzum: 0, total: 100 });
  });

  it("boshqa do'kondagi bir xil artikul aralashmaydi", async () => {
    const { uzum, fake, stock, inventory } = await setup();
    const other = await repo.createShop({ name: 'Boshqa', uzumShopId: 8 });
    const twin = await inventory.createProduct(other.id, { name: 'Hoodie', variants: [{ code: 'HOODIE-QORA', initialOwn: 50 }] });
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])]; // 7-do'kon nakladnoyi
    await uzum.sync();
    expect((await stock())['HOODIE-QORA']!.own).toBe(70);
    expect((await inventory.getProduct(twin.id)).stock.own).toBe(50);
  });

  it('vaqt cheklangan bo’lsa, yangilash bosqichma-bosqich davom etadi va natija bir xil', async () => {
    const { uzum, fake, stock } = await setup();
    fake.invoices = [invoice(1, [{ skuId: 11, qty: 30 }])];
    // Juda kichik vaqt: har chaqiruvda faqat bitta bosqich
    let calls = 0;
    let report = await uzum.sync({ budgetMs: 0 });
    calls++;
    while (!report.done && calls < 20) {
      report = await uzum.sync({ budgetMs: 0 });
      calls++;
    }
    expect(report.done).toBe(true);
    expect(calls).toBeGreaterThan(1);
    expect((await stock())['HOODIE-QORA']!.own).toBe(70);
    // Keyingi to'liq aylana hech narsani takrorlamaydi
    const again = await uzum.sync();
    expect(again.done).toBe(true);
    expect((await stock())['HOODIE-QORA']!.own).toBe(70);
  });
});
