// Postgres drayverlari. Adapter faqat `PgDriver` interfeysini biladi.
import type { PgDriver, SqlClient } from './postgresRepository.ts';

/** Haqiqiy Postgres (Netlify DB / Neon va boshqalar) — `pg` paketi orqali. */
export async function createPgDriver(connectionString: string): Promise<PgDriver> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    // Serverless funksiyada ulanishlar kam bo'lsin; Neon SSL talab qiladi.
    max: Number(process.env.PG_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    // Tashqi baza (Neon va h.k.) — SSL majburiy, sertifikat tekshiriladi. Manzildagi sslmode ustun turadi.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : true,
  });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[] }>,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: SqlClient = { query: (sql, params) => client.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[] }> };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
