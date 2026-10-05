// Bog'lash nuqtasi: qaysi adapter, qaysi avtorizatsiya va qaysi Uzum mijozi ishlatilishi faqat shu yerda hal qilinadi.
import { SessionSigner } from './auth/session.ts';
import { SingleAccountProvider } from './auth/singleAccountProvider.ts';
import type { AuthProvider } from './auth/authProvider.ts';
import { config } from './config.ts';
import { HttpUzumApi } from './integrations/uzum/client.ts';
import { UzumSyncService } from './integrations/uzum/sync.ts';
import { InventoryService } from './services/inventory.ts';
import type { Repository } from './storage/repository.ts';
import { SqliteRepository } from './storage/sqlite/sqliteRepository.ts';

export function createRepository(): Repository {
  switch (config.dbDriver) {
    case 'sqlite':
      return new SqliteRepository(config.sqlitePath);
    // case 'postgres': return new PostgresRepository(process.env.DATABASE_URL!);
    default:
      throw new Error(`Noma'lum DB_DRIVER: ${config.dbDriver}`);
  }
}

export function createAuthProvider(): AuthProvider {
  return new SingleAccountProvider(config.login, config.password);
}

export function createContainer() {
  const repo = createRepository();
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

export type Container = ReturnType<typeof createContainer>;
