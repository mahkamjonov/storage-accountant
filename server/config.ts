// Sozlamalar: .env fayli (bo'lsa) va muhit o'zgaruvchilaridan.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const DEFAULT_LOGIN = 'sotuvchi';
const DEFAULT_PASSWORD = 'ombor2026';

/** Netlify Functions (yoki boshqa serverless) — doimiy disk yo'q, sayt internetda ochiq. */
const serverless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Xato: noto'g'ri sozlangan holda ishga tushmaslik yaxshiroq (masalan, internetda standart parol bilan). */
function required(name: string, hint: string): never {
  throw new Error(`${name} sozlanmagan. ${hint}`);
}

function sessionSecret(dataDir: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (serverless) required('SESSION_SECRET', "Netlify → Site configuration → Environment variables bo'limida kamida 32 belgili tasodifiy qiymat qo'shing.");
  // Lokal: birinchi ishga tushishda yaratiladi va saqlanadi — server qayta ishga tushsa ham sessiya saqlanib qoladi.
  const file = resolve(dataDir, '.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function password(): string {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  if (serverless) required('APP_PASSWORD', "Sayt internetda ochiq — Netlify'da o'z parolingizni (APP_PASSWORD) kiriting.");
  return DEFAULT_PASSWORD;
}

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
/** Postgres manzili: o'zingizniki yoki Netlify DB (Neon) avtomatik beradigan. */
const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || null;

export const config = {
  serverless,
  // PORT emas: ko'p muhitlar (va Vite) PORT'ni o'zlari band qiladi.
  port: Number(process.env.APP_PORT ?? 8787),
  dataDir,
  /** 'sqlite' (lokal, standart) yoki 'postgres' (DATABASE_URL berilsa — avtomatik). */
  dbDriver: process.env.DB_DRIVER ?? (databaseUrl ? 'postgres' : 'sqlite'),
  databaseUrl,
  sqlitePath: resolve(process.env.SQLITE_PATH ?? resolve(dataDir, 'ombor.db')),
  login: process.env.APP_LOGIN ?? DEFAULT_LOGIN,
  password: password(),
  usingDefaultPassword: !process.env.APP_PASSWORD,
  sessionSecret: sessionSecret(dataDir),
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
