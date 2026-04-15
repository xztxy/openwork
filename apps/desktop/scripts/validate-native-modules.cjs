// Phase 4c of the OpenCode SDK cutover port removed `node-pty` from the
// desktop app. The remaining Electron native module to validate is
// better-sqlite3. Keeping this script (instead of deleting it) leaves room
// for future native deps without changing the package.json invocation.
const requiredModules = ['better-sqlite3'];

try {
  for (const moduleName of requiredModules) {
    require(moduleName);
  }
  console.log('[desktop] Electron native module validation passed');
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[desktop] Electron native module validation failed');
  console.error(message);
  process.exit(1);
}
