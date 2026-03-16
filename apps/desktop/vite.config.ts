import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import path from 'path';
import { builtinModules } from 'module';
import pkg from './package.json';

const nodeExternals = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Externalize all node_modules — only bundle local source files.
// Vite 8 (rolldown) does not auto-convert CJS require() to ESM imports,
// so any bundled third-party package that internally calls require() for
// Node built-ins will fail at runtime in an ESM context.
// Workspace packages (@accomplish_ai/*) are aliased to local source and must be bundled.
const externalizeNodeModules = (id: string) => {
  if (id.startsWith('@accomplish_ai/')) return false;
  return !id.startsWith('.') && !id.startsWith('/') && !id.includes('\0') && !path.isAbsolute(id);
};

export default defineConfig(() => ({
  plugins: [
    electron([
      {
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          startup();
        },
        vite: {
          resolve: {
            alias: {
              '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
            },
          },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: externalizeNodeModules,
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
              entry: 'src/preload/index.ts',
              formats: ['cjs'],
              fileName: (format, entryName) =>
                format === 'cjs' ? `${entryName}.cjs` : `${entryName}.mjs`,
            },
            rollupOptions: {
              external: ['electron', ...nodeExternals],
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
