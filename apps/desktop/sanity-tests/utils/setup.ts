// apps/desktop/sanity-tests/utils/setup.ts
import { validateApiKeys, getModelsToTest } from './models';
import { setupOutputDirectory, seedInputFile, SANITY_OUTPUT_DIR } from './validators';

/**
 * Global setup for sanity tests.
 * Called once before all tests run.
 */
export function globalSetup(): void {
  console.log('\n=== Sanity Test Setup ===\n');

  // Validate API keys
  console.log('Validating API keys...');
  validateApiKeys();
  console.log('  All required API keys present\n');

  // Show which models will be tested
  const models = getModelsToTest();
  console.log('Models to test:');
  for (const m of models) {
    console.log(`  - ${m.displayName} (${m.provider}/${m.modelId})`);
  }
  console.log('');

  // Setup output directory
  console.log(`Setting up output directory: ${SANITY_OUTPUT_DIR}`);
  setupOutputDirectory();
  console.log('  Directory created and cleaned\n');

  // Seed input files
  console.log('Seeding test input files...');
  seedInputFile();
  console.log('  input.txt created\n');

  console.log('=== Setup Complete ===\n');
}
