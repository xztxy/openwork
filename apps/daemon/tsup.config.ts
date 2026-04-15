import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  clean: true,
  splitting: false,
  sourcemap: true,
  // Native modules must stay external — they are compiled per-platform
  // and loaded from daemon/node_modules/ in the packaged app.
  external: [
    'better-sqlite3',
    // Optional private package — resolved at runtime via dynamic import, not bundled.
    // In OSS builds it's absent (noop fallback). In Free builds CI copies it into dist/.
    '@accomplish/llm-gateway-client',
  ],
  // Bundle all JS dependencies so the packaged daemon is self-contained.
  // Only native modules (above) remain as external imports.
  // Baileys + pino are bundled for WhatsApp integration in the daemon.
  noExternal: ['@accomplish_ai/agent-core', 'zod', '@whiskeysockets/baileys', 'pino'],
});
