// Netlify rejali funksiyasi: har 5 daqiqada Uzumdan yangilaydi.
// Rejali funksiya 30 soniya bilan cheklangan — yangilash bosqichma-bosqich: vaqt tugasa, keyingi safar davom etadi.
import type { Config } from '@netlify/functions';

// Sozlamalar Netlify'da ekanini bilsin (bu yerda NETLIFY o'zgaruvchisi yo'q).
process.env.OMBOR_SERVERLESS = '1';

export default async (): Promise<void> => {
  const { getContainer } = await import('../../server/container.ts');
  const { uzum } = await getContainer();
  if (!uzum.configured) return;
  try {
    const r = await uzum.sync({ budgetMs: 20_000 });
    console.log(
      `Uzum: ${r.done ? 'aylana tugadi' : 'davom etadi'} — ${r.documents} hujjat, ${r.changes.applied} yangi, ${r.changes.pending} kutilmoqda, ${r.changes.unmatched} bog'lanmagan.`,
    );
  } catch (err) {
    // "Yangilash allaqachon ketyapti" — oddiy holat; boshqa xatolar Uzum sahifasida ko'rinadi.
    console.error(err instanceof Error ? err.message : err);
  }
};

export const config: Config = {
  schedule: '*/5 * * * *',
};
