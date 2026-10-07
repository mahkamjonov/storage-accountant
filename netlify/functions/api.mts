// Netlify Function: butun API (/api/*). Xuddi lokal serverdagi Hono ilovasi — faqat boshqa joyda ishga tushadi.
import type { Config } from '@netlify/functions';

// Sozlamalar Netlify'da ekanini bilsin (bu yerda NETLIFY o'zgaruvchisi yo'q).
process.env.OMBOR_SERVERLESS = '1';

type Handler = (req: Request) => Response | Promise<Response>;
let handler: Promise<Handler> | null = null;

async function load(): Promise<Handler> {
  const { config } = await import('../../server/config.ts');
  const { getContainer } = await import('../../server/container.ts');
  const { createApp } = await import('../../server/http/app.ts');
  const container = await getContainer();
  const app = createApp({ ...container, secureCookies: config.secureCookies, syncBudgetMs: config.syncBudgetMs });
  return (req) => app.fetch(req);
}

export default async (req: Request): Promise<Response> => {
  try {
    // Xato ham saqlanadi: sozlamalar faqat qayta deploy bilan o'zgaradi, har so'rovda bir xil tushunarli xabar chiqadi.
    handler ??= load();
    return await (await handler)(req);
  } catch (err) {
    // Sozlama yetishmasa (masalan, APP_PASSWORD), sababini kirish sahifasida ko'rsatamiz.
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return Response.json({ error: { code: 'SERVER_CONFIG', message: `Server sozlanmagan: ${message}` } }, { status: 500 });
  }
};

export const config: Config = {
  path: '/api/*',
};
