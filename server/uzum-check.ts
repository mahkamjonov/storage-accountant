// Uzum API ulanishini tekshirish: `npm run uzum:tekshir`
// Hech narsa yozmaydi — faqat Uzumdan o'qiydi va ilova kutayotgan maydonlar kelayotganini ko'rsatadi.
import { config } from './config.ts';
import { HttpUzumApi } from './integrations/uzum/client.ts';
import { invoiceStatus, mapCatalog, parseUzumDate } from './integrations/uzum/mapping.ts';

async function main() {
  if (!config.uzumApiKey) {
    console.log(".env faylida UZUM_API_KEY yo'q. Kalitni yozib, qaytadan ishga tushiring.");
    process.exitCode = 1;
    return;
  }
  const api = new HttpUzumApi(config.uzumApiKey);

  const shops = await api.shops();
  console.log(`\n✔ Do'konlar (${shops.length}):`, shops.map((s) => `${s.id} — ${s.name ?? ''}`).join('; '));
  const shopIds = config.uzumShopIds.length ? config.uzumShopIds : shops.map((s) => s.id);

  const { productList, totalProductsAmount } = await api.productsPage(shopIds[0]!, 0, 20);
  const skus = mapCatalog(productList);
  console.log(`\n✔ Katalog: ${totalProductsAmount ?? '?'} ta kartochka (birinchi sahifada ${skus.length} ta SKU). Namuna:`);
  for (const s of skus.slice(0, 5)) {
    console.log(`  skuId=${s.skuId} | ${s.productTitle} | skuTitle="${s.skuTitle}" | artikul="${s.article ?? ''}" | sotuvchi kodi="${s.sellerSkuCode ?? ''}" | ${s.characteristics ?? ''} | Uzumda=${s.quantityActive}`);
  }
  const skuIds = new Set(skus.map((s) => s.skuId));

  const invoices = await api.invoicesPage(0, 10);
  console.log(`\n✔ Yetkazib berish nakladnoylari (oxirgi ${invoices.length} ta):`);
  for (const inv of invoices.slice(0, 5)) {
    const lines = (inv.productForInvoiceDto ?? []).flatMap((p) => p.skuForInvoiceDtoList ?? []);
    const known = lines.filter((l) => skuIds.has(l.id)).length;
    console.log(
      `  №${inv.invoiceNumber ?? inv.id} | sana="${inv.dateCreated}" → ${parseUzumDate(inv.dateCreated)} | holat=${invoiceStatus(inv)} | ` +
        `jo'natilgan=${inv.totalToStock} qabul=${inv.totalAccepted} | tarkib qatorlari=${lines.length} (katalogdagi skuId bilan mos: ${known})`,
    );
  }

  const returns = await api.returnsPage(0, 10);
  console.log(`\n✔ Qaytarish nakladnoylari (oxirgi ${returns.length} ta):`);
  for (const r of returns.slice(0, 5)) {
    console.log(`  №${r.externalNumber ?? r.id} | holat=${r.status} | turi=${r.type} | yaratilgan=${r.dateCreated} | yakunlangan=${r.completedDate ?? '—'} | qatorlar=${r.returnItems?.length ?? 0}`);
  }

  const now = Date.now();
  const { orderItems, totalElements } = await api.ordersPage({ shopIds, dateFrom: now - 7 * 86_400_000, dateTo: now, page: 0, size: 10 });
  console.log(`\n✔ Oxirgi 7 kundagi sotuvlar: ${totalElements ?? orderItems.length} ta qator. Namuna:`);
  for (const o of orderItems.slice(0, 5)) {
    console.log(`  buyurtma ${o.orderId} | ${o.skuTitle} | sotuvchi kodi="${o.sellerSkuCode ?? ''}" | soni=${o.amount} bekor=${o.cancelled ?? 0} qaytgan=${o.amountReturns ?? 0} | holat=${o.status}`);
  }
  console.log('\nHammasi o\'qildi. Ilovaga hech narsa yozilmadi.');
}

main().catch((err: Error) => {
  console.error(`\n✘ ${err.message}`);
  process.exitCode = 1;
});
