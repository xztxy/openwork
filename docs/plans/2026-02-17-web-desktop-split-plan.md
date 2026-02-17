# Web/Desktop Split Implementation Plan


**Goal:** Split `apps/desktop` into `apps/web` (standalone React UI) + `apps/desktop` (thin Electron shell), mirroring accomplish-enterprise's `apps/web` structure for easy code migration between repos.

**Architecture:** Create `apps/web` as a new package with the React UI code moved from `apps/desktop/src/renderer/` to `apps/web/src/client/`. Desktop becomes a thin Electron shell that loads web's build output. Router extracted to separate file matching enterprise pattern.

**Tech Stack:** React 19, Vite 6, React Router 7 (hash router), Zustand 5, Tailwind CSS 3.4, shadcn/ui, Framer Motion, Vitest

---

## Task 1: Create apps/web package scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.client.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/index.html`

**Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@accomplish/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.client.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.client.json --noEmit",
    "lint": "tsc -p tsconfig.client.json --noEmit",
    "preview": "vite preview",
    "test": "vitest run",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:watch": "vitest watch"
  },
  "dependencies": {
    "@accomplish_ai/agent-core": "workspace:*",
    "@radix-ui/react-avatar": "^1.1.2",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-dropdown-menu": "^2.1.4",
    "@radix-ui/react-label": "^2.1.1",
    "@radix-ui/react-popover": "^1.1.4",
    "@radix-ui/react-select": "^2.1.4",
    "@radix-ui/react-separator": "^1.1.1",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-tooltip": "^1.1.6",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "framer-motion": "^12.26.2",
    "lucide-react": "^0.454.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.1",
    "react-router-dom": "^7.1.1",
    "remark-gfm": "^4.0.1",
    "tailwind-merge": "^3.3.1",
    "zod": "^3.24.1",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/typography": "^0.5.15",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "^16.3.1",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "@vitest/coverage-v8": "^4.0.17",
    "autoprefixer": "^10.4.20",
    "jsdom": "^27.4.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.7.2",
    "vite": "^6.0.6",
    "vitest": "^4.0.17"
  }
}
```

Note: No electron, node-pty, better-sqlite3, electron-store, hono, wrangler, or AWS/Azure SDK deps. These stay in desktop.

**Step 2: Create `apps/web/tsconfig.json`**

This is the project-references root (matches enterprise pattern):

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.client.json" }]
}
```

**Step 3: Create `apps/web/tsconfig.client.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/client/*"],
      "@accomplish_ai/agent-core/common": ["../../packages/agent-core/src/common.ts"],
      "@accomplish_ai/agent-core": ["../../packages/agent-core/src/index.ts"],
      "@accomplish_ai/agent-core/*": ["../../packages/agent-core/src/*"]
    }
  },
  "include": ["src/client/**/*", "src/shared/**/*", "../../packages/agent-core/src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create `apps/web/vite.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
      '@accomplish_ai/agent-core/common': path.resolve(
        __dirname,
        '../../packages/agent-core/src/common',
      ),
      '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
```

No electron plugin, no electron externals, no `__APP_TIER__` define.

**Step 5: Create `apps/web/tailwind.config.ts`**

Copy from `apps/desktop/tailwind.config.ts` but change content path from `./src/renderer/**` to `./src/**`:

```typescript
import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import tailwindcssTypography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ... (exact same theme as desktop tailwind.config.ts)
    },
  },
  plugins: [tailwindcssAnimate, tailwindcssTypography],
};

export default config;
```

The full theme object is identical to desktop's. Copy it exactly.

**Step 6: Create `apps/web/postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 7: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Accomplish</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

No CSP meta tag (enterprise doesn't have one in HTML — it's handled server-side). No inline theme script (will be in main.tsx).

**Step 8: Run pnpm install to register new workspace**

Run: `pnpm install`

**Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold apps/web package with configs"
```

---

## Task 2: Move renderer source to apps/web/src/client

**Files:**
- Move: `apps/desktop/src/renderer/**/*` → `apps/web/src/client/**/*`
- Create: `apps/web/src/shared/index.ts`

**Step 1: Copy all renderer source files**

```bash
mkdir -p apps/web/src/client
cp -r apps/desktop/src/renderer/* apps/web/src/client/
```

**Step 2: Create `apps/web/src/shared/index.ts`**

Matches enterprise structure but without tier types (no enterprise concept):

```typescript
// Shared types between client and potential future server
export {};
```

**Step 3: Extract router to `apps/web/src/client/router.tsx`**

Create new file matching enterprise's pattern. Extract routing from App.tsx:

```typescript
import { createHashRouter } from 'react-router-dom';
import App from './App';
import HomePage from './pages/Home';
import ExecutionPage from './pages/Execution';
import { Navigate } from 'react-router-dom';

export const router = createHashRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: HomePage },
      { path: 'execution/:id', Component: ExecutionPage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
```

**Step 4: Update `apps/web/src/client/main.tsx`**

Match enterprise's pattern using `RouterProvider`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { initTheme } from './lib/theme';
import './styles/globals.css';

initTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

**Step 5: Update `apps/web/src/client/App.tsx`**

Refactor to use `useOutlet` pattern (matching enterprise) instead of inline `<Routes>`:

- Remove: `Routes`, `Route`, `Navigate` imports from react-router-dom
- Remove: `useLocation` import
- Add: `useOutlet`, `useLocation` from react-router-dom
- Remove: All `<Routes>` JSX and replace with `<AnimatedOutletWrapper />`
- Remove: Enterprise-specific code (AuthGate, tier system, `isEnterprise`)
- Keep: All other logic (auth error, settings, sidebar, keyboard shortcuts)

The App component should use `useOutlet()` for child route rendering with AnimatePresence, matching enterprise's `AnimatedOutlet` + `AnimatedOutletWrapper` pattern. See enterprise's App.tsx for reference.

Key changes in the App component:
1. Add `AnimatedOutlet` function component (freezes outlet for exit animation)
2. Add `AnimatedOutletWrapper` component (handles AnimatePresence + motion)
3. Replace `<AnimatePresence><Routes>...</Routes></AnimatePresence>` with `<AnimatedOutletWrapper />`
4. Export as named export `export function App()` (not default) to match enterprise
5. Remove the `isRunningInElectron()` check that blocks non-Electron usage — the web app must work in a browser

**Step 6: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): move renderer code to apps/web/src/client"
```

---

## Task 3: Move renderer tests to apps/web

**Files:**
- Move: `apps/desktop/__tests__/unit/renderer/**/*` → `apps/web/__tests__/unit/renderer/**/*`
- Move: `apps/desktop/__tests__/integration/renderer/**/*` → `apps/web/__tests__/integration/renderer/**/*`
- Move: `apps/desktop/__tests__/renderer/**/*` → `apps/web/__tests__/unit/renderer/**/*` (legacy path)
- Create: `apps/web/__tests__/setup.ts`
- Create: `apps/web/vitest.unit.config.ts`
- Create: `apps/web/vitest.integration.config.ts`

**Step 1: Copy renderer test files**

```bash
mkdir -p apps/web/__tests__/unit/renderer apps/web/__tests__/integration/renderer
cp -r apps/desktop/__tests__/unit/renderer/* apps/web/__tests__/unit/renderer/
cp -r apps/desktop/__tests__/integration/renderer/* apps/web/__tests__/integration/renderer/
# Legacy path tests
cp -r apps/desktop/__tests__/renderer/* apps/web/__tests__/unit/renderer/
```

**Step 2: Create `apps/web/__tests__/setup.ts`**

Client-only setup (no better-sqlite3 mock needed):

```typescript
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

export {};
```

No `better-sqlite3` mock — that's an Electron/main-process concern.

**Step 3: Create `apps/web/vitest.unit.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
      '@accomplish_ai/agent-core/common': path.resolve(
        __dirname,
        '../../packages/agent-core/src/common',
      ),
      '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
    },
  },
  test: {
    name: 'unit',
    globals: true,
    root: __dirname,
    include: ['__tests__/**/*.unit.test.{ts,tsx}'],
    setupFiles: ['__tests__/setup.ts'],
    environment: 'jsdom',
    testTimeout: 5000,
    hookTimeout: 10000,
  },
});
```

All renderer tests use jsdom — no environment matching needed (no main process tests here).

**Step 4: Create `apps/web/vitest.integration.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
      '@accomplish_ai/agent-core/common': path.resolve(
        __dirname,
        '../../packages/agent-core/src/common',
      ),
      '@accomplish_ai/agent-core': path.resolve(__dirname, '../../packages/agent-core/src'),
    },
  },
  test: {
    name: 'integration',
    globals: true,
    root: __dirname,
    include: ['__tests__/**/*.integration.test.{ts,tsx}'],
    setupFiles: ['__tests__/setup.ts'],
    environment: 'jsdom',
    testTimeout: 10000,
    hookTimeout: 15000,
  },
});
```

**Step 5: Update test imports**

All test files that import from `@/` will automatically resolve to `src/client/` via the alias. But any tests importing from `@main/` need to be removed or updated — those are main-process tests that should stay in desktop.

Search all moved test files for `@main/` imports and remove/update them.

**Step 6: Commit**

```bash
git add apps/web/__tests__/
git commit -m "feat(web): move renderer tests to apps/web"
```

---

## Task 4: Move public assets to apps/web

**Files:**
- Move: `apps/desktop/public/assets/` → `apps/web/public/assets/`
- Move: `apps/desktop/public/fonts/` → `apps/web/public/fonts/` (if exists, else fonts are in CSS)

**Step 1: Copy public assets**

```bash
mkdir -p apps/web/public
cp -r apps/desktop/public/assets apps/web/public/
```

Check if fonts are referenced from public or CSS. The desktop `globals.css` likely has `@font-face` declarations pointing to `/assets/fonts/` or similar. Copy those too.

**Step 2: Verify font paths in globals.css**

Read `apps/web/src/client/styles/globals.css` and ensure font `@font-face` `src` paths resolve correctly with the new `public/` location.

**Step 3: Commit**

```bash
git add apps/web/public/
git commit -m "feat(web): move public assets to apps/web"
```

---

## Task 5: Update apps/desktop to be thin Electron shell

**Files:**
- Modify: `apps/desktop/package.json` — add dependency on `@accomplish/web`, remove renderer-only deps
- Modify: `apps/desktop/vite.config.ts` — remove renderer build, keep only electron plugin for main/preload
- Modify: `apps/desktop/tsconfig.json` — remove renderer paths
- Modify: `apps/desktop/index.html` — point to web's built output or dev server
- Modify: `apps/desktop/src/main/index.ts` — load web's output

**Step 1: Update `apps/desktop/package.json`**

Add dependency:
```json
"@accomplish/web": "workspace:*"
```

Remove renderer-only dependencies (these are now in apps/web):
- `@radix-ui/*` (all of them)
- `class-variance-authority`
- `clsx`
- `framer-motion`
- `lucide-react`
- `react-markdown`
- `react-router-dom`
- `remark-gfm`
- `tailwind-merge`
- `zustand`
- `zod`

Keep:
- `react`, `react-dom` (needed for preload types)
- `@accomplish_ai/agent-core`
- All Electron/native deps (electron, node-pty, better-sqlite3, electron-store, etc.)
- All AWS/Azure SDK deps

Remove devDependencies that are renderer-only:
- `@tailwindcss/typography`
- `@testing-library/*` (renderer tests moved to web)
- `@vitejs/plugin-react` (no longer building renderer)
- `autoprefixer`, `postcss`, `tailwindcss`, `tailwindcss-animate`
- `jsdom`, `happy-dom` (renderer test env)

Keep devDependencies:
- `electron`, `electron-builder`, `@electron/rebuild`
- `esbuild`
- `@playwright/test` (E2E tests stay here)
- `typescript`, `vite`, `vite-plugin-electron`
- `vitest`, `@vitest/coverage-v8` (for main process tests)

**Step 2: Update `apps/desktop/vite.config.ts`**

Remove the renderer build config. Keep only electron plugin for main + preload:

```typescript
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
  // No renderer aliases needed — renderer is in apps/web now
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
```

**Step 3: Update `apps/desktop/tsconfig.json`**

Remove renderer paths:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@main/*": ["src/main/*"],
      "@accomplish_ai/agent-core/common": ["../../packages/agent-core/src/common.ts"],
      "@accomplish_ai/agent-core": ["../../packages/agent-core/src/index.ts"],
      "@accomplish_ai/agent-core/*": ["../../packages/agent-core/src/*"]
    }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "../../packages/agent-core/src/**/*"],
  "exclude": ["node_modules", "dist", "dist-electron", "release"]
}
```

No DOM lib, no JSX, no `@/` alias — this is now Node/Electron only.

**Step 4: Update `apps/desktop/src/main/index.ts`**

The main process needs to load web's build output. Find where `mainWindow.loadFile()` or `mainWindow.loadURL()` is called and update it:

- In dev: load `http://localhost:5173` (web's Vite dev server)
- In prod: load `path.join(__dirname, '../../web/dist/client/index.html')` or resolve from the `@accomplish/web` package

This is the key integration point. The exact implementation depends on how `mainWindow` is created in `src/main/index.ts`. Read the file and update the load path.

**Step 5: Update `apps/desktop/index.html`**

This file may no longer be needed since the renderer HTML is now in apps/web. However, Vite electron plugin may still need it as an entry point. If so, make it a minimal redirect or keep it pointing to the web dev server.

Alternatively, if `vite-plugin-electron` requires an HTML entry for dev, keep a minimal `index.html` that just loads from web's dev server.

**Step 6: Remove renderer source from desktop**

```bash
rm -rf apps/desktop/src/renderer
```

**Step 7: Remove renderer test files from desktop**

```bash
rm -rf apps/desktop/__tests__/unit/renderer
rm -rf apps/desktop/__tests__/integration/renderer
rm -rf apps/desktop/__tests__/renderer
```

**Step 8: Remove renderer-only config files from desktop**

```bash
rm -f apps/desktop/tailwind.config.ts
rm -f apps/desktop/postcss.config.js
```

**Step 9: Update desktop vitest configs**

Update `apps/desktop/vitest.config.ts`, `vitest.unit.config.ts`, `vitest.integration.config.ts`:
- Remove `@/` and `@renderer/` aliases
- Remove jsdom environment matching for renderer globs
- Keep only node environment for main process tests

**Step 10: Update `apps/desktop/package.json` scripts**

Update build script to also build web first:
```json
"build": "pnpm -F @accomplish/web build && tsc && vite build && node scripts/bundle-skills.cjs"
```

Update dev script to start web dev server alongside electron:
```json
"dev": "node scripts/patch-electron-name.cjs && npx electron-rebuild -f && node -e \"require('fs').rmSync('dist-electron',{recursive:true,force:true})\" && concurrently \"pnpm -F @accomplish/web dev\" \"vite\""
```

(May need to add `concurrently` as a devDependency, or use a different approach like `wait-on` to wait for web dev server before starting electron.)

**Step 11: Update electron-builder files config**

In `apps/desktop/package.json` `"build"."files"`, update to include web's build output:
```json
"files": [
  "dist-electron/**/*",
  "../web/dist/client/**/*",
  // ... keep node_modules entries
]
```

Or copy web's dist into desktop's dist before packaging.

**Step 12: Commit**

```bash
git add apps/desktop/
git commit -m "refactor(desktop): slim to thin Electron shell, depend on @accomplish/web"
```

---

## Task 6: Update root package.json and workspace scripts

**Files:**
- Modify: `package.json` (root)

**Step 1: Add web scripts to root**

```json
"dev:web": "pnpm -F @accomplish/web dev",
"build:web": "pnpm -F @accomplish/web build",
"test:web": "pnpm -F @accomplish/web test",
"test:web:unit": "pnpm -F @accomplish/web test:unit",
"test:web:integration": "pnpm -F @accomplish/web test:integration"
```

**Step 2: Update existing root scripts**

The `dev` script currently runs desktop. Keep it, but ensure it starts web first or in parallel.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add apps/web workspace scripts to root"
```

---

## Task 7: Verify everything works

**Step 1: Install dependencies**

Run: `pnpm install`

**Step 2: Typecheck web**

Run: `pnpm -F @accomplish/web typecheck`
Expected: PASS (no type errors)

**Step 3: Run web unit tests**

Run: `pnpm -F @accomplish/web test:unit`
Expected: All renderer unit tests pass

**Step 4: Run web integration tests**

Run: `pnpm -F @accomplish/web test:integration`
Expected: All renderer integration tests pass

**Step 5: Run web dev server**

Run: `pnpm -F @accomplish/web dev`
Expected: Vite starts on localhost:5173. Page loads in browser (may show error about Electron not available — that's expected for now).

**Step 6: Typecheck desktop**

Run: `pnpm -F @accomplish/desktop typecheck`
Expected: PASS (main + preload only)

**Step 7: Run desktop main process tests**

Run: `pnpm -F @accomplish/desktop test`
Expected: All main process tests pass

**Step 8: Run full lint**

Run: `pnpm typecheck && pnpm lint:eslint && pnpm format:check`
Expected: All pass

**Step 9: Fix any issues found**

Address compilation errors, broken imports, path issues.

**Step 10: Final commit**

```bash
git add -A
git commit -m "fix: resolve all typecheck and test issues after split"
```

---

## Task 8: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md` (root)

**Step 1: Update project overview**

Update to reflect the new two-app structure.

**Step 2: Update common commands**

Add `pnpm -F @accomplish/web` commands. Update `pnpm -F @accomplish/desktop` commands to note they no longer include renderer tests.

**Step 3: Update architecture section**

Document the web/desktop split. Update key packages list.

**Step 4: Update TypeScript Path Aliases**

Document that `@/*` in web resolves to `src/client/*` and desktop no longer has `@/` alias.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for web/desktop split"
```
