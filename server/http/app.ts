// HTTP API. Servis va avtorizatsiya qatlamlariga tayanadi, bazani bilmaydi.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isIsoDate, MOVEMENT_TYPES, type MovementType, type Shop, type UzumEventStatus } from '../../domain/index.ts';
import type { UzumSyncService } from '../integrations/uzum/sync.ts';
import type { AuthProvider, User } from '../auth/authProvider.ts';
import type { SessionSigner } from '../auth/session.ts';
import { AppError, type InventoryService } from '../services/inventory.ts';

const COOKIE = 'ombor_session';

export interface AppDeps {
  inventory: InventoryService;
  uzum: UzumSyncService;
  auth: AuthProvider;
  sessions: SessionSigner;
  secureCookies?: boolean;
  /** Bitta "Hozir yangilash" so'rovi uchun vaqt (ms). Serverless'da cheklangan — qolgani keyingi so'rovda. */
  syncBudgetMs?: number;
}

type Env = { Variables: { user: User; shop: Shop } };

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AppError(400, 'INVALID_JSON', "So'rov noto'g'ri yuborildi. Sahifani yangilab, qaytadan urinib ko'ring.");
  }
}

function intParam(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export function createApp(deps: AppDeps) {
  const { inventory, uzum, auth, sessions } = deps;
  const app = new Hono<Env>().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return c.json(
      { error: { code: 'INTERNAL', message: "Kutilmagan xatolik yuz berdi. Bir ozdan keyin qaytadan urinib ko'ring." } },
      500,
    );
  });

  // O'zgartiruvchi so'rovlar faqat JSON bo'lishi kerak: boshqa saytdan oddiy forma orqali yuborib bo'lmaydi.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (!(c.req.header('content-type') ?? '').includes('application/json')) {
        throw new AppError(400, 'JSON_REQUIRED', "So'rov noto'g'ri yuborildi.");
      }
    }
    await next();
  });

  // ---------- Kirish ----------

  app.post('/auth/login', async (c) => {
    const body = await readJson(c);
    const login = typeof body.login === 'string' ? body.login : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await auth.authenticate(login, password);
    if (!user) {
      await new Promise((r) => setTimeout(r, 400));
      throw new AppError(401, 'BAD_CREDENTIALS', "Login yoki parol mos kelmadi. Tekshirib, qaytadan kiriting.");
    }
    setCookie(c, COOKIE, sessions.issue(user.id), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: deps.secureCookies ?? false,
      path: '/',
      maxAge: Math.floor(sessions.maxAgeMs / 1000),
    });
    return c.json({ user });
  });

  app.post('/auth/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Quyidagi barcha yo'llar kirishni talab qiladi.
  app.use('*', async (c, next) => {
    const session = sessions.verify(getCookie(c, COOKIE));
    const user = session ? await auth.getUser(session.uid) : null;
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Davom etish uchun tizimga kiring.');
    c.set('user', user);
    await next();
  });

  app.get('/auth/me', (c) => c.json({ user: c.get('user') }));

  // Joriy do'kon: interfeys har so'rovda "X-Shop-Id" sarlavhasini yuboradi. Bo'lmasa yoki topilmasa — birinchi do'kon.
  app.use('*', async (c, next) => {
    c.set('shop', await inventory.resolveShop(c.req.header('x-shop-id')));
    await next();
  });

  // ---------- Do'konlar ----------

  app.get('/shops', async (c) => c.json({ shops: await inventory.listShops(), current: c.get('shop').id }));

  app.patch('/shops/:id', async (c) => {
    const { name } = await readJson(c);
    return c.json({ shop: await inventory.renameShop(c.req.param('id'), name) });
  });

  // ---------- Bosh sahifa ----------

  app.get('/overview', async (c) => {
    const shop = c.get('shop');
    const [overview, uzumToday] = await Promise.all([inventory.overview(shop.id), inventory.uzumToday(shop.id)]);
    return c.json({ ...overview, uzumToday });
  });

  // ---------- Mahsulotlar ----------

  app.get('/products', async (c) => {
    const products = await inventory.listProducts(c.get('shop').id, { includeArchived: c.req.query('archived') === '1' });
    return c.json({ products });
  });

  app.post('/products', async (c) => {
    const product = await inventory.createProduct(c.get('shop').id, await readJson(c));
    return c.json({ product }, 201);
  });

  app.get('/products/:id', async (c) => c.json({ product: await inventory.getProduct(c.req.param('id')) }));

  app.patch('/products/:id', async (c) => {
    const product = await inventory.updateProduct(c.req.param('id'), await readJson(c));
    return c.json({ product });
  });

  app.post('/products/:id/variants', async (c) => {
    const product = await inventory.addVariant(c.req.param('id'), await readJson(c));
    return c.json({ product }, 201);
  });

  app.patch('/variants/:id', async (c) => {
    const product = await inventory.updateVariant(c.req.param('id'), await readJson(c));
    return c.json({ product });
  });

  // ---------- Harakatlar ----------

  app.get('/movements', async (c) => {
    const types = (c.req.query('type') ?? '')
      .split(',')
      .filter((t): t is MovementType => MOVEMENT_TYPES.includes(t as MovementType));
    const limit = intParam(c.req.query('limit'), 50, 200);
    const offset = intParam(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER);
    // Keyingi sahifa bormi — bittasini ortiq so'rab bilamiz.
    const rows = await inventory.listMovements({
      shopId: c.get('shop').id,
      productId: c.req.query('productId') || undefined,
      variantId: c.req.query('variantId') || undefined,
      types,
      limit: limit + 1,
      offset,
    });
    return c.json({ movements: rows.slice(0, limit), hasMore: rows.length > limit });
  });

  app.post('/movements', async (c) => c.json(await inventory.recordMovement(await readJson(c)), 201));

  app.post('/movements/batch', async (c) => c.json(await inventory.recordBatch(await readJson(c)), 201));

  app.post('/movements/void', async (c) => {
    const { ids } = await readJson(c);
    return c.json(await inventory.voidBatch(ids));
  });

  app.post('/movements/:id/void', async (c) => c.json(await inventory.voidMovement(c.req.param('id'))));

  // ---------- Uzum ----------

  app.get('/uzum/status', async (c) => c.json(await uzum.status(c.get('shop'))));

  app.post('/uzum/sync', async (c) =>
    c.json({ report: await uzum.sync({ budgetMs: deps.syncBudgetMs }), status: await uzum.status(c.get('shop')) }),
  );

  app.put('/uzum/sync-from', async (c) => {
    const { date } = await readJson(c);
    if (!isIsoDate(date)) throw new AppError(400, 'INVALID_DATE', "Sanani to'g'ri tanlang.");
    await uzum.setSyncFrom(date);
    return c.json(await uzum.status(c.get('shop')));
  });

  app.get('/uzum/events', async (c) => {
    const statuses = (c.req.query('status') ?? '').split(',').filter(Boolean) as UzumEventStatus[];
    const limit = intParam(c.req.query('limit'), 100, 500);
    return c.json({ events: await uzum.listEvents(c.get('shop'), statuses.length ? statuses : undefined, limit) });
  });

  app.get('/uzum/catalog', async (c) => c.json({ skus: await uzum.catalog(c.get('shop')) }));

  app.post('/uzum/link', async (c) => {
    const body = await readJson(c);
    if (typeof body.uzumSkuId !== 'number') throw new AppError(400, 'INVALID_INPUT', "Uzum mahsuloti tanlanmagan.");
    const variantId = typeof body.variantId === 'string' && body.variantId ? body.variantId : null;
    await uzum.link(body.uzumSkuId, variantId);
    return c.json({ ok: true });
  });

  app.post('/uzum/import', async (c) => {
    const body = await readJson(c);
    const ids = Array.isArray(body.uzumProductIds) ? body.uzumProductIds.filter((n): n is number => typeof n === 'number') : undefined;
    return c.json(await uzum.importFromUzum(c.get('shop'), ids));
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Topilmadi.' } }, 404));

  return app;
}
