// Yetkazishda: Uzum hali qabul qilmagan nakladnoylardagi sonlar. Sozlamalarda saqlanadi (bazaga yangi jadval kerak emas).
import type { Repository } from '../../storage/repository.ts';

export const OPEN_INVOICES_KEY = 'uzum.openInvoices';

/** Uzum hali qabul qilmagan nakladnoylar: { invoiceId: { skuId: son } }. */
export async function readOpenInvoices(repo: Pick<Repository, 'getSetting'>): Promise<Record<string, Record<string, number>>> {
  try {
    const raw = await repo.getSetting(OPEN_INVOICES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Record<string, number>>) : {};
  } catch {
    return {};
  }
}

/** Har bir Uzum SKU'si bo'yicha "Yetkazishda" yig'indisi. */
export async function transitBySku(repo: Pick<Repository, 'getSetting'>): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  for (const skus of Object.values(await readOpenInvoices(repo))) {
    for (const [skuId, qty] of Object.entries(skus)) {
      const n = Number(qty);
      if (Number.isFinite(n) && n > 0) result.set(Number(skuId), (result.get(Number(skuId)) ?? 0) + n);
    }
  }
  return result;
}
