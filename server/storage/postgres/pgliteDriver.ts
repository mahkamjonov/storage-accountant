// Faqat testlar uchun: jarayon ichidagi Postgres (PGlite). Netlify funksiyasiga kirmaydi.
import type { PgDriver } from './postgresRepository.ts';

/** Jarayon ichidagi Postgres (PGlite) — testlar uchun, tashqi server kerak emas. */
export async function createPgliteDriver(): Promise<PgDriver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  // PGlite bitta ulanish: tranzaksiyalarni navbatga qo'yamiz.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    query: (sql, params) => db.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[] }>,
    transaction(fn) {
      const run = () => db.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[] }> }));
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    close: () => db.close(),
  };
}
