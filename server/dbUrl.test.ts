import { describe, expect, it } from 'vitest';
import { cleanDatabaseUrl } from './dbUrl.ts';

const URL = 'postgresql://neondb_owner:abc@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('cleanDatabaseUrl', () => {
  it("Neon'dan har xil ko'rinishda nusxalangan manzilni tozalaydi", () => {
    expect(cleanDatabaseUrl(URL)).toBe(URL);
    expect(cleanDatabaseUrl(`psql '${URL}'`)).toBe(URL);
    expect(cleanDatabaseUrl(`  "${URL}"
`)).toBe(URL);
    expect(cleanDatabaseUrl(`DATABASE_URL=${URL}`)).toBe(URL);
  });

  it("manzil bo'lmasa — null", () => {
    expect(cleanDatabaseUrl('neondb_owner abc')).toBeNull();
    expect(cleanDatabaseUrl('')).toBeNull();
  });
});
