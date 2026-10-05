// Sozlamalar: .env fayli (bo'lsa) va muhit o'zgaruvchilaridan.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const DEFAULT_LOGIN = 'sotuvchi';
const DEFAULT_PASSWORD = 'ombor2026';

function sessionSecret(dataDir: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Birinchi ishga tushishda yaratiladi va saqlanadi — server qayta ishga tushsa ham sessiya saqlanib qoladi.
  const file = resolve(dataDir, '.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const dataDir = resolve(process.env.DATA_DIR ?? 'data');

export const config = {
  // PORT emas: ko'p muhitlar (va Vite) PORT'ni o'zlari band qiladi.
  port: Number(process.env.APP_PORT ?? 8787),
  dataDir,
  /** Hozircha faqat 'sqlite'. Yangi adapter qo'shilganda shu yerga qo'shiladi. */
  dbDriver: process.env.DB_DRIVER ?? 'sqlite',
  sqlitePath: resolve(process.env.SQLITE_PATH ?? resolve(dataDir, 'ombor.db')),
  login: process.env.APP_LOGIN ?? DEFAULT_LOGIN,
  password: process.env.APP_PASSWORD ?? DEFAULT_PASSWORD,
  usingDefaultPassword: !process.env.APP_PASSWORD,
  sessionSecret: sessionSecret(dataDir),
  secureCookies: process.env.SECURE_COOKIES === '1',
  /** Uzum Seller OpenAPI kaliti (Uzum kabineti → Sozlamalar → API kalitlari). Bo'sh bo'lsa — integratsiya o'chiq. */
  uzumApiKey: process.env.UZUM_API_KEY?.trim() || null,
  /** Faqat sinov uchun: Uzum API manzilini almashtirish (soxta server). */
  uzumApiUrl: process.env.UZUM_API_URL?.trim() || undefined,
  /** Ixtiyoriy: faqat shu do'konlar (vergul bilan). Bo'sh bo'lsa — kalitga tegishli barcha do'konlar. */
  uzumShopIds: (process.env.UZUM_SHOP_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0),
  /** Avtomatik yangilash oralig'i, daqiqa. 0 — faqat qo'lda. */
  uzumSyncMinutes: Number(process.env.UZUM_SYNC_MINUTES ?? 15),
  production: process.env.NODE_ENV === 'production',
};
