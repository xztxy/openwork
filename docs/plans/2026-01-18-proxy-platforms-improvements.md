# Proxy Platforms Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the Proxy Platforms tab by allowing inline API key entry and sorting providers by popularity.

**Architecture:** Modify SettingsDialog.tsx to add an inline API key input form when no key exists, and update the model grouping logic to prioritize well-known providers.

**Tech Stack:** React, TypeScript, existing IPC handlers

---

## Task 1: Add State Variables for Inline API Key Input

**Files:**
- Modify: `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx`

**Step 1: Add new state variables after existing OpenRouter state**

Find this code (around line 77):
```typescript
const [savingOpenrouter, setSavingOpenrouter] = useState(false);
```

Add after it:
```typescript
// OpenRouter inline API key entry (for Proxy Platforms tab)
const [openrouterApiKey, setOpenrouterApiKey] = useState('');
const [openrouterApiKeyError, setOpenrouterApiKeyError] = useState<string | null>(null);
const [savingOpenrouterApiKey, setSavingOpenrouterApiKey] = useState(false);
```

**Step 2: Verify no TypeScript errors**

Run: `pnpm typecheck`
Expected: Success with no errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/layout/SettingsDialog.tsx
git commit -m "feat(settings): add state for inline OpenRouter API key input"
```

---

## Task 2: Add Handler for Saving OpenRouter API Key from Proxy Tab

**Files:**
- Modify: `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx`

**Step 1: Add handler function after handleSaveOpenRouter function**

Find the `handleSaveOpenRouter` function (around line 395-417) and add this new function after it:

```typescript
const handleSaveOpenRouterApiKey = async () => {
  const accomplish = getAccomplish();
  const trimmedKey = openrouterApiKey.trim();

  if (!trimmedKey) {
    setOpenrouterApiKeyError('Please enter an API key.');
    return;
  }

  if (!trimmedKey.startsWith('sk-or-')) {
    setOpenrouterApiKeyError('Invalid API key format. Key should start with sk-or-');
    return;
  }

  setSavingOpenrouterApiKey(true);
  setOpenrouterApiKeyError(null);

  try {
    // Validate the API key
    const validation = await accomplish.validateApiKey(trimmedKey, 'openrouter');
    if (!validation.valid) {
      setOpenrouterApiKeyError(validation.error || 'Invalid API key.');
      setSavingOpenrouterApiKey(false);
      return;
    }

    // Save the API key
    const savedKey = await accomplish.saveApiKey(trimmedKey, 'openrouter');
    setSavedKeys((prev) => {
      const filtered = prev.filter((k) => k.provider !== 'openrouter');
      return [...filtered, savedKey];
    });

    // Clear input and auto-fetch models
    setOpenrouterApiKey('');
    onApiKeySaved?.();

    // Auto-fetch models after saving key
    await handleFetchOpenRouterModels();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save API key.';
    setOpenrouterApiKeyError(message);
  } finally {
    setSavingOpenrouterApiKey(false);
  }
};
```

**Step 2: Verify no TypeScript errors**

Run: `pnpm typecheck`
Expected: Success with no errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/layout/SettingsDialog.tsx
git commit -m "feat(settings): add handler for inline OpenRouter API key save"
```

---

## Task 3: Replace Link with Inline API Key Form

**Files:**
- Modify: `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx`

**Step 1: Replace the "no API key" message with an inline form**

Find this code (around line 671-685):
```typescript
{!hasOpenRouterKey ? (
  <div className="rounded-lg bg-muted p-4">
    <p className="text-sm text-muted-foreground mb-3">
      Add an OpenRouter API key in the Cloud Providers section to use this feature.
    </p>
    <button
      onClick={() => {
        setActiveTab('cloud');
        setProvider('openrouter');
      }}
      className="text-sm text-primary hover:underline"
    >
      Add OpenRouter API Key
    </button>
  </div>
) : (
```

Replace with:
```typescript
{!hasOpenRouterKey ? (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Enter your OpenRouter API key to access 200+ models from multiple providers.
    </p>
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">
        OpenRouter API Key
      </label>
      <input
        type="password"
        value={openrouterApiKey}
        onChange={(e) => {
          setOpenrouterApiKey(e.target.value);
          setOpenrouterApiKeyError(null);
        }}
        placeholder="sk-or-..."
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
    {openrouterApiKeyError && (
      <p className="text-sm text-destructive">{openrouterApiKeyError}</p>
    )}
    <button
      onClick={handleSaveOpenRouterApiKey}
      disabled={savingOpenrouterApiKey || !openrouterApiKey.trim()}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {savingOpenrouterApiKey ? 'Validating...' : 'Save API Key & Fetch Models'}
    </button>
    <p className="text-xs text-muted-foreground">
      Get your API key at{' '}
      <a
        href="https://openrouter.ai/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        openrouter.ai/keys
      </a>
    </p>
  </div>
) : (
```

**Step 2: Verify no TypeScript errors**

Run: `pnpm typecheck`
Expected: Success with no errors

**Step 3: Manual test**

Run: `CLEAN_START=1 pnpm dev`
- Open Settings > Proxy Platforms
- Verify the API key input form appears
- Test entering and saving an API key

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/layout/SettingsDialog.tsx
git commit -m "feat(settings): add inline API key input in Proxy Platforms tab"
```

---

## Task 4: Add Provider Priority Sorting

**Files:**
- Modify: `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx`

**Step 1: Add provider priority constant**

Find this code (around line 33-35):
```typescript
type ProviderId = typeof API_KEY_PROVIDERS[number]['id'];
```

Add after it:
```typescript
// Priority order for OpenRouter providers (lower index = higher priority)
const OPENROUTER_PROVIDER_PRIORITY = [
  'anthropic',
  'openai',
  'google',
  'meta-llama',
  'mistralai',
  'x-ai',
  'deepseek',
  'cohere',
  'perplexity',
  'amazon',
];
```

**Step 2: Update the groupedOpenrouterModels sorting logic**

Find this code (around line 729-731):
```typescript
{Object.entries(groupedOpenrouterModels)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([provider, models]) => (
```

Replace with:
```typescript
{Object.entries(groupedOpenrouterModels)
  .sort(([a], [b]) => {
    const priorityA = OPENROUTER_PROVIDER_PRIORITY.indexOf(a);
    const priorityB = OPENROUTER_PROVIDER_PRIORITY.indexOf(b);
    // If both have priority, sort by priority
    if (priorityA !== -1 && priorityB !== -1) return priorityA - priorityB;
    // Priority providers come first
    if (priorityA !== -1) return -1;
    if (priorityB !== -1) return 1;
    // Otherwise alphabetical
    return a.localeCompare(b);
  })
  .map(([provider, models]) => (
```

**Step 3: Verify no TypeScript errors**

Run: `pnpm typecheck`
Expected: Success with no errors

**Step 4: Manual test**

Run: `pnpm dev`
- Open Settings > Proxy Platforms
- Add an OpenRouter API key if not present
- Click "Fetch Models"
- Verify Anthropic, OpenAI, Google appear at the top of the list

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/layout/SettingsDialog.tsx
git commit -m "feat(settings): sort OpenRouter providers by popularity"
```

---

## Task 5: Update E2E Tests

**Files:**
- Modify: `apps/desktop/e2e/specs/settings.spec.ts`
- Modify: `apps/desktop/e2e/pages/settings.page.ts`

**Step 1: Add page object selectors for new elements**

In `settings.page.ts`, add after `fetchModelsButton` getter:

```typescript
get openrouterApiKeyInput() {
  return this.page.getByPlaceholder('sk-or-...');
}

get saveOpenrouterApiKeyButton() {
  return this.page.getByRole('button', { name: /Save API Key & Fetch Models/ });
}
```

**Step 2: Update test to verify inline API key form**

In `settings.spec.ts`, update the test "should show OpenRouter and LiteLLM options when Proxy Platforms tab is clicked" (around line 427):

Add a new assertion after verifying LiteLLM is visible:
```typescript
// Verify API key input is visible when no key is configured
// (This may or may not be visible depending on test state)
const apiKeyInput = settingsPage.openrouterApiKeyInput;
const keyConfigured = await settingsPage.page.locator('text=API key configured').isVisible();
if (!keyConfigured) {
  await expect(apiKeyInput).toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });
}
```

**Step 3: Run E2E tests**

Run: `pnpm -F @accomplish/desktop test:e2e --grep "Proxy Platforms"`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/desktop/e2e/pages/settings.page.ts apps/desktop/e2e/specs/settings.spec.ts
git commit -m "test(e2e): update tests for inline OpenRouter API key input"
```

---

## Task 6: Final Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: Success

**Step 2: Run full E2E test suite for settings**

Run: `pnpm -F @accomplish/desktop test:e2e --grep "Settings Dialog"`
Expected: All tests pass (may have 1 flaky test that passes on retry)

**Step 3: Manual verification checklist**

Run: `CLEAN_START=1 pnpm dev`

- [ ] Open Settings > Proxy Platforms
- [ ] Verify inline API key input form is shown
- [ ] Enter a valid OpenRouter API key
- [ ] Click "Save API Key & Fetch Models"
- [ ] Verify models are fetched automatically
- [ ] Verify Anthropic, OpenAI, Google appear at top of list
- [ ] Search for a model and verify filtering works
- [ ] Select a model and click "Use This Model"
- [ ] Verify model is saved and appears in "Currently using"

**Step 4: Commit any remaining changes**

If all tests pass and manual verification is complete, no additional commits needed.
