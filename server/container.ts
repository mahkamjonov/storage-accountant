// Bog'lash nuqtasi: qaysi adapter, qaysi avtorizatsiya va qaysi Uzum mijozi ishlatilishi faqat shu yerda hal qilinadi.
import { SessionSigner } from './auth/session.ts';
import { SingleAccountProvider } from './auth/singleAccountProvider.ts';
import type { AuthProvider } from './auth/authProvider.ts';
import { config } from './config.ts';
import { HttpUzumApi } from './integrations/uzum/client.ts';
import { UzumSyncService } from './integrations/uzum/sync.ts';
import { InventoryService } from './services/inventory.ts';
import type { Repository } from './storage/repository.ts';

/** Adapterlar faqat kerak bo'lganda yuklanadi (Netlify'da SQLite moduli umuman kerak emas). */
export async function createRepository(): Promise<Repository> {
  switch (config.dbDriver) {
    case 'sqlite': {
      const { SqliteRepository } = await import('./storage/sqlite/sqliteRepository.ts');
      return new SqliteRepository(config.sqlitePath);
    }
    case 'postgres': {
      if (!config.databaseUrl) throw new Error('DATABASE_URL sozlanmagan (Postgres manzili).');
      const { createPgDriver } = await import('./storage/postgres/drivers.ts');
      const { PostgresRepository } = await import('./storage/postgres/postgresRepository.ts');
      return new PostgresRepository(await createPgDriver(config.databaseUrl));
    }
    default:
      throw new Error(`Noma'lum DB_DRIVER: ${config.dbDriver}`);
  }
}

export function createAuthProvider(): AuthProvider {
  return new SingleAccountProvider(config.login, config.password);
}

export async function createContainer() {
  const repo = await createRepository();
  const inventory = new InventoryService(repo);
  const uzumApi = config.uzumApiKey ? new HttpUzumApi(config.uzumApiKey, config.uzumApiUrl) : null;
  return {
    repo,
    inventory,
    uzum: new UzumSyncService(repo, inventory, uzumApi, { shopIds: config.uzumShopIds }),
    auth: createAuthProvider(),
    sessions: new SessionSigner(config.sessionSecret),
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;

let shared: Promise<Container> | null = null;

/** Serverless funksiyalar uchun: bitta jarayonda konteyner bir marta yaratiladi va qayta ishlatiladi. */
export function getContainer(): Promise<Container> {
  shared ??= createContainer().catch((err) => {
    shared = null;
    throw err;
  });
  return shared;
}
