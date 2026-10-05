// Namunaviy ma'lumotlar: 4 ta kartochka (variantlari bilan) va bir nechta harakat. Baza bo'sh bo'lsagina qo'shadi.
import { buildVariantMatrix, suggestCode, todayIso } from '../domain/index.ts';
import { createContainer } from './container.ts';

const { inventory, repo } = createContainer();

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayIso(d);
}

function variants(base: string, characteristics: { name: string; values: string[] }[]) {
  return buildVariantMatrix(characteristics).map((attributes) => ({ attributes, code: suggestCode(base, attributes) }));
}

async function main() {
  const shop = (await inventory.listShops())[0]!.id;
  const existing = await inventory.listProducts(shop, { includeArchived: true });
  if (existing.length > 0) {
    console.log(`Bazada allaqachon ${existing.length} ta mahsulot bor — namuna qo'shilmadi.`);
    return;
  }

  const hoodie = await inventory.createProduct(shop, {
    name: 'Hoodie oversize, paxta',
    lowStockThreshold: 5,
    variants: variants('HOODIE', [
      { name: 'Rang', values: ['Qora', 'Bej'] },
      { name: "O'lcham", values: ['M', 'L', 'XL'] },
    ]),
  });
  const suit = await inventory.createProduct(shop, {
    name: "Erkaklar sport kostyumi, xudi va shim to'plami",
    lowStockThreshold: 5,
    variants: variants('JORDAN', [
      { name: 'Rang', values: ['Bej', 'Bronza'] },
      { name: "O'lcham", values: ['L', 'XL'] },
    ]),
  });
  const bottle = await inventory.createProduct(shop, {
    name: 'Termos shisha 500 ml',
    variants: variants('TERMOS-500', [{ name: 'Rang', values: ['Kulrang', 'Qora'] }]),
  });
  const caseProduct = await inventory.createProduct(shop, {
    name: "Telefon g'ilofi iPhone 15, shaffof",
    lowStockThreshold: 20,
    variants: [{ code: 'GL-IP15-CL' }],
  });

  const v = (p: typeof hoodie, i: number) => p.variants[i]!.id;
  const steps: [string, Record<string, unknown>][] = [
    // Qabul mezonidagi stsenariy: keldi 100 → jo'natdim 30 → sotildi 5 → qaytdi 2 = 72 / 23 / 95
    [v(hoodie, 1), { type: 'received', quantity: 100, date: daysAgo(12), note: 'Toshkent, Abu Saxiy' }],
    [v(hoodie, 1), { type: 'to_uzum', quantity: 30, date: daysAgo(10) }],
    [v(hoodie, 1), { type: 'sold', quantity: 5, date: daysAgo(6) }],
    [v(hoodie, 1), { type: 'returned', quantity: 2, date: daysAgo(3), note: "O'lchami to'g'ri kelmagan" }],
    [v(hoodie, 0), { type: 'received', quantity: 40, date: daysAgo(12) }],
    [v(hoodie, 0), { type: 'to_uzum', quantity: 30, date: daysAgo(10) }],
    [v(hoodie, 0), { type: 'sold', quantity: 27, date: daysAgo(2) }],
    [v(hoodie, 3), { type: 'received', quantity: 25, date: daysAgo(9) }],
    [v(suit, 0), { type: 'received', quantity: 20, date: daysAgo(8) }],
    [v(suit, 0), { type: 'to_uzum', quantity: 12, date: daysAgo(7) }],
    [v(suit, 1), { type: 'received', quantity: 20, date: daysAgo(8) }],
    [v(suit, 2), { type: 'received', quantity: 15, date: daysAgo(8) }],
    [v(bottle, 0), { type: 'received', quantity: 60, date: daysAgo(8) }],
    [v(bottle, 0), { type: 'to_uzum', quantity: 25, date: daysAgo(7) }],
    [v(bottle, 0), { type: 'written_off', quantity: 2, location: 'own', date: daysAgo(5), note: "Qopqog'i singan" }],
    [v(bottle, 0), { type: 'sold', quantity: 9, date: daysAgo(1) }],
    [v(caseProduct, 0), { type: 'received', quantity: 50, date: daysAgo(4) }],
    [v(caseProduct, 0), { type: 'to_uzum', quantity: 45, date: daysAgo(4) }],
    [v(caseProduct, 0), { type: 'sold', quantity: 31, date: daysAgo(0) }],
  ];
  for (const [variantId, input] of steps) await inventory.recordMovement({ variantId, ...input });

  console.log(`Namuna qo'shildi: 4 ta mahsulot kartochkasi, ${steps.length} ta harakat.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => repo.close?.());
