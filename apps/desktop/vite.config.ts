import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import path from 'path';
import pkg from './package.json';

export default defineConfig(() => ({
  plugins: [
    electron([
      {
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          const inspectArg = process.env.ELECTRON_DEBUG
            ? `--inspect=${process.env.ELECTRON_DEBUG_PORT || '9229'}`
            : undefined;
          const argv = ['.', '--no-sandbox', ...(inspectArg ? [inspectArg] : [])];
          startup(argv);
        },
        vite: {
          resolve: {
            alias: {
              '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
            },
          },
          build: {
            sourcemap: true,
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'electron-store', 'keytar', 'node-pty', 'better-sqlite3'],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          define: {
            'process.env.npm_package_version': JSON.stringify(pkg.version),
          },
          build: {
            outDir: 'dist-electron/preload',
            lib: {
              formats: ['cjs'],
              fileName: (format, entryName) =>
                format === 'cjs' ? `${entryName}.cjs` : `${entryName}.mjs`,
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@accomplish_ai/agent-core/common': path.resolve(
        __dirname,
        '../../packages/agent-core/src/common',
      ),
      '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
    },
  },
}));
