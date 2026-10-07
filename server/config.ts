// Sozlamalar: .env fayli (bo'lsa) va muhit o'zgaruvchilaridan.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const DEFAULT_LOGIN = 'sotuvchi';
const DEFAULT_PASSWORD = 'ombor2026';

/**
 * Netlify Functions (yoki boshqa serverless) — doimiy disk yo'q, sayt internetda ochiq.
 * Netlify funksiyasi ishlayotganda `NETLIFY` o'zgaruvchisi yo'q (u faqat build paytida bor), shuning uchun
 * funksiya fayllari `OMBOR_SERVERLESS=1` ni o'zlari o'rnatadi.
 */
const serverless = Boolean(
  process.env.OMBOR_SERVERLESS || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT,
);

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
/** Postgres manzili: o'zingizniki yoki Netlify DB (Neon) avtomatik beradigan. */
const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || null;

// Serverless'da noto'g'ri sozlangan holda ishga tushmaymiz — yetishmayotganlarning hammasini bir xabarda aytamiz.
if (serverless) {
  const missing: string[] = [];
  if (!process.env.APP_PASSWORD) missing.push('APP_PASSWORD (kirish paroli)');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET (kamida 32 belgili tasodifiy qator)');
  if (!databaseUrl) missing.push('DATABASE_URL (Postgres manzili — neon.tech dan bepul)');
  if (missing.length) {
    throw new Error(
      `Netlify'da yetishmayapti: ${missing.join('; ')}. Site configuration → Environment variables'da qo'shing, keyin Deploys → Trigger deploy.`,
    );
  }
}

function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Lokal: birinchi ishga tushishda yaratiladi va saqlanadi — server qayta ishga tushsa ham sessiya saqlanib qoladi.
  const file = resolve(dataDir, '.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  serverless,
  // PORT emas: ko'p muhitlar (va Vite) PORT'ni o'zlari band qiladi.
  port: Number(process.env.APP_PORT ?? 8787),
  dataDir,
  /** 'sqlite' (lokal, standart) yoki 'postgres' (DATABASE_URL berilsa — avtomatik). */
  dbDriver: serverless ? 'postgres' : (process.env.DB_DRIVER ?? (databaseUrl ? 'postgres' : 'sqlite')),
  databaseUrl,
  sqlitePath: resolve(process.env.SQLITE_PATH ?? resolve(dataDir, 'ombor.db')),
  login: process.env.APP_LOGIN ?? DEFAULT_LOGIN,
  password: process.env.APP_PASSWORD || DEFAULT_PASSWORD,
  usingDefaultPassword: !process.env.APP_PASSWORD,
  sessionSecret: sessionSecret(),
  secureCookies: serverless || process.env.SECURE_COOKIES === '1',
  /** Uzum Seller OpenAPI kaliti (Uzum kabineti → Sozlamalar → API kalitlari). Bo'sh bo'lsa — integratsiya o'chiq. */
  uzumApiKey: process.env.UZUM_API_KEY?.trim() || null,
  /** Faqat sinov uchun: Uzum API manzilini almashtirish (soxta server). */
  uzumApiUrl: process.env.UZUM_API_URL?.trim() || undefined,
  /** Ixtiyoriy: faqat shu do'konlar (vergul bilan). Bo'sh bo'lsa — kalitga tegishli barcha do'konlar. */
  uzumShopIds: (process.env.UZUM_SHOP_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0),
  /** Avtomatik yangilash oralig'i, daqiqa (lokal server uchun). 0 — faqat qo'lda. Netlify'da jadval netlify.toml'da. */
  uzumSyncMinutes: Number(process.env.UZUM_SYNC_MINUTES ?? 15),
  /**
   * Bitta yangilash chaqiruvi uchun vaqt (ms). Netlify funksiyalari vaqt bilan cheklangan — yangilash bosqichma-bosqich
   * bajariladi va keyingi chaqiruvda to'xtagan joyidan davom etadi. Lokal serverda cheklov yo'q.
   */
  syncBudgetMs: Number(process.env.SYNC_BUDGET_MS ?? (serverless ? 8_000 : 0)) || Infinity,
  production: process.env.NODE_ENV === 'production',
};
