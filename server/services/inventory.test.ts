// Bir xil testlar har bir saqlash adapteri uchun ishga tushadi (server/testing.ts → adapters).
import { afterEach, describe, expect, it } from 'vitest';
import { adapters, expectAppError } from '../testing.ts';
import type { Repository } from '../storage/repository.ts';
import { InventoryService } from './inventory.ts';

describe.each(adapters)('InventoryService (%s)', (_name, makeRepo) => {
  let repo: Repository;
  afterEach(async () => {
    await repo?.close?.();
  });

  async function setup() {
    repo = await makeRepo();
    const service = new InventoryService(repo);
    const shop = (await service.listShops())[0]!.id;
    return { service, shop };
  }

  /** Bitta variantli kartochka. */
  async function simple(service: InventoryService, shop: string, name: string, code: string | null = null) {
    const p = await service.createProduct(shop, { name, variants: [{ code }] });
    return { product: p, variantId: p.variants[0]!.id };
  }

  it('kartochka variantlar bilan yaratiladi: har biri o\'z artikuli va qoldig\'i bilan', async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      lowStockThreshold: 5,
      variants: [
        { attributes: [{ name: 'Rang', value: 'Qora' }, { name: "O'lcham", value: 'M' }], code: 'HOODIE-QORA-M', initialOwn: 20 },
        { attributes: [{ name: 'Rang', value: 'Qora' }, { name: "O'lcham", value: 'L' }], code: 'HOODIE-QORA-L', initialOwn: 3, initialUzum: 4 },
      ],
    });
    expect(p.variants).toHaveLength(2);
    expect(p.variants.map((v) => v.stock.total)).toEqual([20, 7]);
    expect(p.stock).toEqual({ own: 23, uzum: 4, total: 27 });
    expect(p.variants[1]!.low).toBe(false);
    expect(p.low).toBe(false);

    const overview = await service.overview(shop);
    expect(overview.variantCount).toBe(2);
    expect(overview.totals.total).toBe(27);
  });

  it('artikul takrorlanmaydi (katta-kichik harfdan qat\'i nazar)', async () => {
    const { service, shop } = await setup();
    await simple(service, shop, 'A', 'ABC-1');
    const err = await expectAppError(simple(service, shop, 'B', 'abc-1'), 'CODE_TAKEN');
    expect(err.message).toContain('allaqachon bor: A');
    await expectAppError(
      service.createProduct(shop, { name: 'C', variants: [{ code: 'X' }, { code: 'x' }] }),
      'DUPLICATE_CODE',
    );
  });

  it('yangi mahsulot qo\'shib, "Mahsulot keldi" kiritiladi (1-mezon)', async () => {
    const { service, shop } = await setup();
    const { variantId } = await simple(service, shop, 'Futbolka');
    const r = await service.recordMovement({ variantId, type: 'received', quantity: 50 });
    expect(r.before.own).toBe(0);
    expect(r.after.own).toBe(50);
  });

  it('keldi 100 → jo\'natdim 30 → sotildi 5 → qaytdi 2 = 72 / 23 / 95 (2-mezon)', async () => {
    const { service, shop } = await setup();
    const { product, variantId } = await simple(service, shop, 'Krossovka');
    await service.recordMovement({ variantId, type: 'received', quantity: 100 });
    await service.recordMovement({ variantId, type: 'to_uzum', quantity: 30 });
    await service.recordMovement({ variantId, type: 'sold', quantity: 5 });
    await service.recordMovement({ variantId, type: 'returned', quantity: 2 });

    expect((await service.getProduct(product.id)).stock).toEqual({ own: 72, uzum: 23, total: 95 });
    expect((await service.overview(shop)).totals).toEqual({ own: 72, uzum: 23, total: 95 });
  });

  it('bekor qilingan yozuv tarixda qoladi, qoldiq qayta hisoblanadi (3-mezon)', async () => {
    const { service, shop } = await setup();
    const { product, variantId } = await simple(service, shop, 'Sumka');
    await service.recordMovement({ variantId, type: 'received', quantity: 100 });
    const { movement } = await service.recordMovement({ variantId, type: 'to_uzum', quantity: 30 });

    const result = await service.voidMovement(movement.id);
    expect(result.after).toEqual({ own: 100, uzum: 0, total: 100 });

    const history = await service.listMovements({ productId: product.id });
    expect(history).toHaveLength(2);
    expect(history.find((m) => m.id === movement.id)?.voidedAt).not.toBeNull();
  });

  it('mavjud qoldiqdan ortiq kiritib bo\'lmaydi (4-mezon)', async () => {
    const { service, shop } = await setup();
    const { variantId } = await simple(service, shop, 'Kepka');
    await service.recordMovement({ variantId, type: 'received', quantity: 40 });
    const err = await expectAppError(service.recordMovement({ variantId, type: 'to_uzum', quantity: 41 }), 'NOT_ENOUGH');
    expect(err.message).toContain('Omboringizda faqat 40 ta bor');
  });

  it('har bir variant qoldig\'i alohida: bir variantdan ortiq jo\'natib bo\'lmaydi', async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      variants: [
        { attributes: [{ name: 'Rang', value: 'Qora' }], initialOwn: 10 },
        { attributes: [{ name: 'Rang', value: 'Oq' }], initialOwn: 2 },
      ],
    });
    await expectAppError(service.recordMovement({ variantId: p.variants[1]!.id, type: 'to_uzum', quantity: 3 }), 'NOT_ENOUGH');
    await service.recordMovement({ variantId: p.variants[0]!.id, type: 'to_uzum', quantity: 10 });
  });

  it('bekor qilish qoldiqni manfiy qilsa, ruxsat berilmaydi', async () => {
    const { service, shop } = await setup();
    const { variantId } = await simple(service, shop, "Ko'ylak");
    const { movement } = await service.recordMovement({ variantId, type: 'received', quantity: 10 });
    await service.recordMovement({ variantId, type: 'to_uzum', quantity: 8 });
    await expectAppError(service.voidMovement(movement.id), 'VOID_GOES_NEGATIVE');
  });

  it('sanab tuzatish farqni o\'zi hisoblaydi', async () => {
    const { service, shop } = await setup();
    const { variantId } = await simple(service, shop, 'Paypoq');
    await service.recordMovement({ variantId, type: 'received', quantity: 50 });
    const r = await service.recordMovement({ variantId, type: 'adjustment', location: 'own', counted: 47 });
    expect(r.movement).toMatchObject({ quantity: 3, direction: 'decrease', countedQuantity: 47 });
    await expectAppError(service.recordMovement({ variantId, type: 'adjustment', location: 'own', counted: 47 }), 'NO_CHANGE');
  });

  it('variant qo\'shish, tahrirlash va arxivlash', async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, { name: 'Hoodie', variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }] }] });
    const withNew = await service.addVariant(p.id, { attributes: [{ name: 'Rang', value: 'Oq' }], code: 'H-OQ', initialOwn: 5 });
    expect(withNew.variants).toHaveLength(2);
    await expectAppError(service.addVariant(p.id, { attributes: [{ name: 'Rang', value: 'oq' }] }), 'DUPLICATE_VARIANT');

    const oq = withNew.variants.find((v) => v.code === 'H-OQ')!;
    const edited = await service.updateVariant(oq.id, { code: 'H-WHITE', archived: true });
    expect(edited.variants.find((v) => v.id === oq.id)).toMatchObject({ code: 'H-WHITE', archived: true });
    expect(edited.stock.total).toBe(0); // arxivdagi variant jamiga kirmaydi
    await expectAppError(service.recordMovement({ variantId: oq.id, type: 'received', quantity: 1 }), 'ARCHIVED');
  });

  it('arxivdagi kartochka ro\'yxatda ko\'rinmaydi', async () => {
    const { service, shop } = await setup();
    const { product, variantId } = await simple(service, shop, 'Eski model');
    await service.updateProduct(product.id, { archived: true });
    expect(await service.listProducts(shop)).toHaveLength(0);
    expect(await service.listProducts(shop, { includeArchived: true })).toHaveLength(1);
    await expectAppError(service.recordMovement({ variantId, type: 'received', quantity: 1 }), 'ARCHIVED');
  });

  it('bir vaqtda kelgan so\'rovlar qoldiqni manfiy qila olmaydi', async () => {
    const { service, shop } = await setup();
    const { variantId } = await simple(service, shop, 'Choynak');
    await service.recordMovement({ variantId, type: 'received', quantity: 10 });
    const results = await Promise.allSettled([
      service.recordMovement({ variantId, type: 'to_uzum', quantity: 6 }),
      service.recordMovement({ variantId, type: 'to_uzum', quantity: 6 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('tarix kartochka yoki variant bo\'yicha filtrlanadi', async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }] }, { attributes: [{ name: 'Rang', value: 'Oq' }] }],
    });
    const [qora, oq] = p.variants;
    await service.recordMovement({ variantId: qora!.id, type: 'received', quantity: 5, date: '2026-09-01' });
    await service.recordMovement({ variantId: oq!.id, type: 'received', quantity: 5, date: '2026-09-03' });
    expect(await service.listMovements({ productId: p.id })).toHaveLength(2);
    expect(await service.listMovements({ variantId: oq!.id })).toHaveLength(1);
    expect((await service.listMovements({})).map((m) => m.date)).toEqual(['2026-09-03', '2026-09-01']);
  });

  it('"Mahsulot keldi" bir nechta variant uchun bitta saqlashda yoziladi', async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }] }, { attributes: [{ name: 'Rang', value: 'Oq' }] }],
    });
    const [qora, oq] = p.variants;
    const r = await service.recordBatch({
      type: 'received',
      items: [
        { variantId: qora!.id, quantity: 10 },
        { variantId: oq!.id, quantity: 4 },
        { variantId: oq!.id, quantity: null }, // bo'sh qator o'tkaziladi
      ],
    });
    expect(r.movements).toHaveLength(2);
    expect((await service.getProduct(p.id)).stock).toEqual({ own: 14, uzum: 0, total: 14 });

    // Hammasini birdan bekor qilish (Undo)
    await service.voidBatch(r.movements.map((m) => m.id));
    expect((await service.getProduct(p.id)).stock.total).toBe(0);
  });

  it("batch: bitta qator xato bo'lsa, hech biri yozilmaydi va xabarda variant nomi bor", async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }], initialOwn: 5 }, { attributes: [{ name: 'Rang', value: 'Oq' }] }],
    });
    const [qora, oq] = p.variants;
    const err = await expectAppError(
      service.recordBatch({ type: 'written_off', location: 'own', items: [{ variantId: qora!.id, quantity: 2 }, { variantId: oq!.id, quantity: 1 }] }),
      'NOT_ENOUGH',
    );
    expect(err.message).toContain('Hoodie (Oq)');
    expect((await service.getProduct(p.id)).stock.own).toBe(5);
  });

  it("batch sanab tuzatish: o'zgarmagan qatorlar o'tkaziladi", async () => {
    const { service, shop } = await setup();
    const p = await service.createProduct(shop, {
      name: 'Hoodie',
      variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }], initialOwn: 5 }, { attributes: [{ name: 'Rang', value: 'Oq' }], initialOwn: 3 }],
    });
    const [qora, oq] = p.variants;
    const r = await service.recordBatch({
      type: 'adjustment',
      location: 'own',
      items: [{ variantId: qora!.id, counted: 5 }, { variantId: oq!.id, counted: 1 }],
    });
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]).toMatchObject({ variantId: oq!.id, direction: 'decrease', quantity: 2 });
    await expectAppError(service.recordBatch({ type: 'adjustment', location: 'own', items: [{ variantId: qora!.id, counted: 5 }] }), 'NOTHING_TO_SAVE');
  });

  it("do'konlar alohida: ro'yxat, qoldiq va artikul aralashmaydi", async () => {
    const { service, shop } = await setup();
    const other = (await repo.createShop({ name: "Ikkinchi do'kon" })).id;
    await service.createProduct(shop, { name: 'A', variants: [{ code: 'KOD-1', initialOwn: 5 }] });
    // Boshqa do'konda o'sha artikul bo'lishi mumkin
    await service.createProduct(other, { name: 'B', variants: [{ code: 'kod-1', initialOwn: 7 }] });
    expect((await service.listProducts(shop)).map((p) => p.name)).toEqual(['A']);
    expect((await service.overview(other)).totals.own).toBe(7);
    expect(await service.listMovements({ shopId: shop })).toHaveLength(1);
    // Bitta do'kon ichida takrorlanmaydi
    await expectAppError(service.createProduct(other, { name: 'C', variants: [{ code: 'KOD-1' }] }), 'CODE_TAKEN');
  });
});
