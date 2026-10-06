import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['domain/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    // Postgres testlari PGlite (WASM) bilan ishlaydi — birinchi ishga tushishi bir necha soniya oladi.
    testTimeout: 30_000,
  },
});
