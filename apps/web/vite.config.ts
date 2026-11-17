import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API runs on :3000 and Vite forwards /api to it, which mimics the Vercel rewrite of production
// (Phase 2: the browser sees ONE origin, so cookies are first-party and no CORS is needed).
export default defineConfig({
  plugins: [react(), ...(process.env.VITEST ? [] : [tailwindcss()])],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000' } },
  },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 15_000,
  },
});
