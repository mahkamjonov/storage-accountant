import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.APP_PORT ?? '8787';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // telefondan bir xil Wi‑Fi tarmog'ida ochish uchun
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
