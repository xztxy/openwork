import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: __dirname,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 10000,
  },
});
