# Dependency Check Design

## Problem

When new MCPs are added, developers must run `pnpm install` before `pnpm dev`. If they forget, the MCP silently fails to load with no indication something is wrong.

## Solution

Fail fast at dev startup with a clear error message if dependencies are out of sync.

## Mechanism

Store a hash of `pnpm-lock.yaml` in `node_modules/.lockfile-hash` after install. Before dev, compare current lockfile hash against stored hash.

### Scripts

**`scripts/check-deps.cjs`** - Runs before dev:

```javascript
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const lockfilePath = path.join(__dirname, '..', 'pnpm-lock.yaml');
const hashPath = path.join(__dirname, '..', 'node_modules', '.lockfile-hash');

const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
const currentHash = crypto.createHash('sha256').update(lockfileContent).digest('hex').slice(0, 16);

if (!fs.existsSync(hashPath)) {
  console.error('\n❌ Dependencies not installed. Run: pnpm install\n');
  process.exit(1);
}

const storedHash = fs.readFileSync(hashPath, 'utf8').trim();
if (storedHash !== currentHash) {
  console.error('\n❌ Dependencies out of sync. Run: pnpm install\n');
  process.exit(1);
}
```

**`scripts/save-lockfile-hash.cjs`** - Runs after install:

```javascript
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const lockfilePath = path.join(__dirname, '..', 'pnpm-lock.yaml');
const hashPath = path.join(__dirname, '..', 'node_modules', '.lockfile-hash');

const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
const hash = crypto.createHash('sha256').update(lockfileContent).digest('hex').slice(0, 16);

fs.writeFileSync(hashPath, hash);
```

### package.json Changes

```json
{
  "scripts": {
    "predev": "node scripts/check-deps.cjs",
    "dev": "pnpm -F @accomplish/desktop dev",
    "postinstall": "node scripts/save-lockfile-hash.cjs"
  }
}
```

## Flow

1. `pnpm install` runs → `postinstall` saves lockfile hash
2. `pnpm dev` runs → `predev` checks hash
3. Mismatch or missing → fails with clear message
4. Match → proceeds to dev

## Edge Cases

- **Fresh clone:** Hash file missing → error prompts install
- **CI/CD:** No impact - runs `pnpm install` explicitly

## Migration

Existing developers run `pnpm install` once to generate the hash file.

## Files

| File | Action |
|------|--------|
| `scripts/check-deps.cjs` | Create |
| `scripts/save-lockfile-hash.cjs` | Create |
| `package.json` | Add `predev`, update `postinstall` |
