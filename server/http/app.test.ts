import { describe, expect, it } from 'vitest';
import { SessionSigner } from '../auth/session.ts';
import { SingleAccountProvider } from '../auth/singleAccountProvider.ts';
import { UzumSyncService } from '../integrations/uzum/sync.ts';
import { InventoryService } from '../services/inventory.ts';
import { MemoryRepository } from '../storage/memory/memoryRepository.ts';
import { createApp } from './app.ts';

function makeApp() {
  const repo = new MemoryRepository();
  const inventory = new InventoryService(repo);
  return createApp({
    inventory,
    uzum: new UzumSyncService(repo, inventory, null),
    auth: new SingleAccountProvider('sotuvchi', 'test-parol'),
    sessions: new SessionSigner('test-secret'),
  });
}

function setup() {
  const app = makeApp();
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call };
}

describe('HTTP API', () => {
  it('kirmasdan ma\'lumot olib bo\'lmaydi', async () => {
    const { call } = setup();
    expect((await call('GET', '/overview')).status).toBe(401);
  });

  it('noto\'g\'ri parol rad etiladi', async () => {
    const { call } = setup();
    const r = await call('POST', '/auth/login', { login: 'sotuvchi', password: 'xato' });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toContain('mos kelmadi');
  });

  it('to\'liq oqim: kirish → kartochka → harakatlar → bekor qilish', async () => {
    const { call } = setup();
    expect((await call('POST', '/auth/login', { login: 'Sotuvchi', password: 'test-parol' })).status).toBe(200);

    const { json: created } = await call('POST', '/products', {
      name: 'Futbolka',
      variants: [{ attributes: [{ name: 'Rang', value: 'Qora' }], code: 'FT-QORA' }],
    });
    const variantId = created.product.variants[0].id;
    await call('POST', '/movements', { variantId, type: 'received', quantity: 100 });
    await call('POST', '/movements', { variantId, type: 'to_uzum', quantity: 30 });
    await call('POST', '/movements', { variantId, type: 'sold', quantity: 5 });
    const last = await call('POST', '/movements', { variantId, type: 'returned', quantity: 2 });
    expect(last.json.after).toEqual({ own: 72, uzum: 23, total: 95 });

    const tooMany = await call('POST', '/movements', { variantId, type: 'to_uzum', quantity: 73 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.error.message).toContain('Omboringizda faqat 72 ta bor');

    const voided = await call('POST', `/movements/${last.json.movement.id}/void`, {});
    expect(voided.json.after).toEqual({ own: 70, uzum: 25, total: 95 });

    const history = await call('GET', `/movements?productId=${created.product.id}`);
    expect(history.json.movements).toHaveLength(4);
  });

  it('Uzum ulanmagan bo\'lsa, holat buni aytadi va yangilash tushunarli xato beradi', async () => {
    const { call } = setup();
    await call('POST', '/auth/login', { login: 'sotuvchi', password: 'test-parol' });
    expect((await call('GET', '/uzum/status')).json.configured).toBe(false);
    const r = await call('POST', '/uzum/sync', {});
    expect(r.status).toBe(503);
    expect(r.json.error.message).toContain('UZUM_API_KEY');
  });

  it('JSON bo\'lmagan o\'zgartiruvchi so\'rov rad etiladi', async () => {
    const res = await makeApp().request('/api/auth/login', {
      method: 'POST',
      body: 'login=a&password=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(400);
  });
});
