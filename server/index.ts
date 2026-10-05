import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config.ts';
import { createContainer } from './container.ts';
import { createApp } from './http/app.ts';

const container = createContainer();
const app = new Hono();
app.route('/', createApp({ ...container, secureCookies: config.secureCookies }));

// Qurilgan interfeys (npm run build) bo'lsa, shu serverning o'zi uni beradi.
const dist = resolve('web/dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: 'web/dist' }));
  // Har safar o'qiladi: qayta build qilinganda server qayta ishga tushirilmasa ham yangi versiya beriladi.
  app.get('*', (c) => c.html(readFileSync(resolve(dist, 'index.html'), 'utf8')));
}

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Ombor hisobi ishga tushdi: http://localhost:${port}`);
  if (!existsSync(dist)) console.log("Interfeys uchun: npm run dev (yoki avval npm run build)");
  if (config.usingDefaultPassword) {
    console.warn(`Diqqat: standart login/parol ishlatilmoqda (${config.login} / ${config.password}). .env faylida APP_PASSWORD ni o'zgartiring.`);
  }
});

// Uzum bilan avtomatik yangilash
let timer: NodeJS.Timeout | undefined;
if (container.uzum.configured) {
  const run = () =>
    container.uzum
      .sync()
      .then((r) => console.log(`Uzum yangilandi: ${r.documents} hujjat, ${r.changes.applied} yangi yozuv, ${r.changes.pending} kutilmoqda, ${r.changes.unmatched} bog'lanmagan.`))
      .catch((err: Error) => console.error(`Uzum yangilashda xato: ${err.message}`));
  setTimeout(run, 3000);
  if (config.uzumSyncMinutes > 0) timer = setInterval(run, config.uzumSyncMinutes * 60_000);
} else {
  console.log("Uzum ulanmagan: .env fayliga UZUM_API_KEY yozilsa, avtomatik yangilanadi.");
}

function shutdown() {
  clearInterval(timer);
  server.close();
  void container.repo.close?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
