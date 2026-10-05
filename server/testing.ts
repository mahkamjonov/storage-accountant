// Testlar uchun umumiy yordamchilar. Yangi saqlash adapteri yozilganda shu ro'yxatga qo'shiladi —
// barcha servis va sinxronlash testlari unda ham ishga tushadi.
import { expect } from 'vitest';
import { AppError } from './services/inventory.ts';
import { MemoryRepository } from './storage/memory/memoryRepository.ts';
import type { Repository } from './storage/repository.ts';
import { SqliteRepository } from './storage/sqlite/sqliteRepository.ts';

export const adapters: [string, () => Repository][] = [
  ['memory', () => new MemoryRepository()],
  ['sqlite', () => new SqliteRepository(':memory:')],
];

export async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}
