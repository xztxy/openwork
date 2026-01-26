#!/usr/bin/env node
/**
 * Bundle MCP skills for production using esbuild.
 *
 * This script compiles TypeScript skills to standalone JavaScript bundles,
 * eliminating the need for tsx at runtime and avoiding pnpm symlink issues
 * in the packaged Electron app.
 *
 * Run: node scripts/bundle-skills.cjs
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * Skills to bundle with their entry points and any external dependencies
 * that should NOT be bundled (native modules, etc.)
 */
const SKILLS = [
  {
    name: 'dev-browser',
    entry: 'src/index.ts',
    // Also bundle the server entry point
    additionalEntries: ['scripts/start-server.ts'],
    // Keep playwright external - it has native bindings
    external: ['playwright', 'rebrowser-playwright'],
  },
  {
    name: 'dev-browser-mcp',
    entry: 'src/index.ts',
    external: ['playwright', 'rebrowser-playwright'],
  },
  {
    name: 'file-permission',
    entry: 'src/index.ts',
    external: [],
  },
  {
    name: 'ask-user-question',
    entry: 'src/index.ts',
    external: [],
  },
  {
    name: 'complete-task',
    entry: 'src/index.ts',
    external: [],
  },
];

/**
 * Create esbuild alias plugin to resolve path aliases like @/* -> ./src/*
 */
function createAliasPlugin(skillDir) {
  return {
    name: 'alias',
    setup(build) {
      // Resolve @/* to ./src/*
      build.onResolve({ filter: /^@\// }, (args) => {
        const relativePath = args.path.replace(/^@\//, '');
        // Remove .js extension if present (TypeScript uses .js in imports but files are .ts)
        const cleanPath = relativePath.replace(/\.js$/, '');
        const resolved = path.join(skillDir, 'src', cleanPath);
        // Try .ts first, then .js, then as-is
        const extensions = ['.ts', '.js', ''];
        for (const ext of extensions) {
          const fullPath = resolved + ext;
          if (fs.existsSync(fullPath)) {
            return { path: fullPath };
          }
        }
        // Check if it's a directory with index.ts
        const indexPath = path.join(resolved, 'index.ts');
        if (fs.existsSync(indexPath)) {
          return { path: indexPath };
        }
        return { path: resolved + '.ts' };
      });
    },
  };
}

/**
 * Bundle a single skill
 */
async function bundleSkill(skill) {
  const skillDir = path.join(SKILLS_DIR, skill.name);
  const distDir = path.join(skillDir, 'dist');

  // Check if skill exists
  if (!fs.existsSync(skillDir)) {
    console.log(`  ⚠️  Skill directory not found: ${skill.name}, skipping`);
    return false;
  }

  const entryPath = path.join(skillDir, skill.entry);
  if (!fs.existsSync(entryPath)) {
    console.log(`  ⚠️  Entry point not found: ${entryPath}, skipping`);
    return false;
  }

  // Create dist directory
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log(`  📦 Bundling ${skill.name}...`);

  try {
    // Bundle main entry point
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: path.join(distDir, 'index.mjs'),
      plugins: [createAliasPlugin(skillDir)],
      external: [
        // Node.js built-ins should be external
        'path', 'fs', 'os', 'child_process', 'crypto', 'http', 'https',
        'net', 'url', 'util', 'stream', 'events', 'buffer', 'querystring',
        'assert', 'tty', 'zlib', 'dns', 'module', 'readline', 'vm',
        'worker_threads', 'cluster', 'dgram', 'inspector', 'perf_hooks',
        'async_hooks', 'string_decoder', 'timers', 'process',
        // Electron
        'electron',
        // Skill-specific externals
        ...skill.external,
      ],
      // Handle __dirname and __filename in ESM
      define: {
        'import.meta.url': 'import.meta.url',
      },
      // Banner to handle __dirname in ESM
      banner: {
        js: `
import { fileURLToPath as __bundle_fileURLToPath } from 'url';
import { dirname as __bundle_dirname } from 'path';
const __filename = __bundle_fileURLToPath(import.meta.url);
const __dirname = __bundle_dirname(__filename);
`.trim(),
      },
      // Source maps for debugging
      sourcemap: true,
      // Minify for smaller size
      minify: true,
      // Keep names for better stack traces
      keepNames: true,
    });

    // Bundle additional entry points if specified
    if (skill.additionalEntries) {
      for (const additionalEntry of skill.additionalEntries) {
        const additionalPath = path.join(skillDir, additionalEntry);
        if (!fs.existsSync(additionalPath)) {
          console.log(`    ⚠️  Additional entry not found: ${additionalEntry}, skipping`);
          continue;
        }

        const outName = path.basename(additionalEntry, '.ts') + '.mjs';
        await esbuild.build({
          entryPoints: [additionalPath],
          bundle: true,
          platform: 'node',
          target: 'node20',
          format: 'esm',
          outfile: path.join(distDir, outName),
          plugins: [createAliasPlugin(skillDir)],
          external: [
            'path', 'fs', 'os', 'child_process', 'crypto', 'http', 'https',
            'net', 'url', 'util', 'stream', 'events', 'buffer', 'querystring',
            'assert', 'tty', 'zlib', 'dns', 'module', 'readline', 'vm',
            'worker_threads', 'cluster', 'dgram', 'inspector', 'perf_hooks',
            'async_hooks', 'string_decoder', 'timers', 'process',
            'electron',
            ...skill.external,
          ],
          banner: {
            js: `
import { fileURLToPath as __bundle_fileURLToPath } from 'url';
import { dirname as __bundle_dirname } from 'path';
const __filename = __bundle_fileURLToPath(import.meta.url);
const __dirname = __bundle_dirname(__filename);
`.trim(),
          },
          sourcemap: true,
          minify: true,
          keepNames: true,
        });
        console.log(`    ✓ Bundled ${additionalEntry}`);
      }
    }

    // Get bundle size
    const bundlePath = path.join(distDir, 'index.mjs');
    const stats = fs.statSync(bundlePath);
    const sizeKB = Math.round(stats.size / 1024);

    console.log(`    ✓ ${skill.name}/dist/index.mjs (${sizeKB} KB)`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to bundle ${skill.name}:`, error.message);
    return false;
  }
}

/**
 * Create a bundled version of server.cjs for dev-browser
 * This replaces the tsx-based launcher with a direct node launcher
 */
async function createBundledServerLauncher() {
  const serverLauncherPath = path.join(SKILLS_DIR, 'dev-browser', 'dist', 'server-launcher.cjs');

  const launcherCode = `#!/usr/bin/env node
/**
 * Production server launcher for dev-browser.
 * Runs the pre-bundled start-server.mjs directly with Node.js.
 * No tsx or TypeScript compilation needed at runtime.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const distDir = __dirname;
const isWindows = process.platform === 'win32';

// Parse command line arguments
const headless = process.argv.includes('--headless');

// Logging helper
function log(...args) {
  const timestamp = new Date().toISOString();
  console.error(\`[dev-browser launcher \${timestamp}]\`, ...args);
}

log('Starting bundled dev-browser server...');
log('  distDir:', distDir);
log('  headless:', headless);

// Find node executable
let nodeExe = 'node';
if (process.env.NODE_BIN_PATH) {
  const bundledNode = path.join(process.env.NODE_BIN_PATH, isWindows ? 'node.exe' : 'node');
  if (fs.existsSync(bundledNode)) {
    nodeExe = bundledNode;
    log('  Using bundled node:', nodeExe);
  }
}

// Path to bundled server
const serverPath = path.join(distDir, 'start-server.mjs');
if (!fs.existsSync(serverPath)) {
  log('ERROR: Bundled server not found at:', serverPath);
  process.exit(1);
}

// Build environment
const env = { ...process.env };
if (headless) {
  env.HEADLESS = 'true';
}

log('Spawning:', nodeExe, serverPath);

const child = spawn(nodeExe, [serverPath], {
  cwd: path.dirname(distDir), // Parent of dist = skill root
  stdio: 'inherit',
  env,
  windowsHide: true,
});

child.on('error', (err) => {
  log('ERROR: Failed to spawn:', err.message);
  process.exit(1);
});

child.on('close', (code, signal) => {
  log('Process exited with code:', code, 'signal:', signal);
  process.exit(code || 0);
});
`;

  fs.writeFileSync(serverLauncherPath, launcherCode);
  console.log('    ✓ Created server-launcher.cjs');
}

/**
 * Main bundling function
 */
async function main() {
  console.log('\n🔧 Bundling MCP skills for production...\n');

  let successCount = 0;
  let failCount = 0;

  for (const skill of SKILLS) {
    const success = await bundleSkill(skill);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Create the bundled server launcher for dev-browser
  console.log('\n  📦 Creating dev-browser server launcher...');
  await createBundledServerLauncher();

  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Bundled ${successCount} skills successfully`);
  if (failCount > 0) {
    console.log(`⚠️  ${failCount} skills failed to bundle`);
  }
  console.log('─'.repeat(50) + '\n');

  // Exit with error if any failed
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Bundle failed:', error);
  process.exit(1);
});
