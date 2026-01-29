// apps/desktop/scripts/test-system-prompt.ts
// Run with: npx tsx apps/desktop/scripts/test-system-prompt.ts

import path from 'path';
import fs from 'fs';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'prompt-test-' + Date.now());
const SKILLS_PATH = path.join(TEST_DIR, 'skills');

fs.mkdirSync(SKILLS_PATH, { recursive: true });
console.log('Test directory:', TEST_DIR);

function createTestSkill(name: string, description: string, content: string) {
  const skillDir = path.join(SKILLS_PATH, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: ${name}
description: ${description}
---

${content}`);
}

createTestSkill('browser-automation', 'Automate web browsers', '# Browser Automation\n\nUse browser_* tools.');
createTestSkill('file-manager', 'Manage files', '# File Manager\n\nUse file_* tools.');
createTestSkill('disabled-skill', 'Disabled', '# Disabled\n\nShould not appear.');

interface Skill {
  id: string;
  name: string;
  command: string;
  description: string;
  filePath: string;
  isEnabled: boolean;
}

const skills: Skill[] = [
  { id: '1', name: 'browser-automation', command: '/browser', description: 'Automate web browsers', filePath: path.join(SKILLS_PATH, 'browser-automation', 'SKILL.md'), isEnabled: true },
  { id: '2', name: 'file-manager', command: '/files', description: 'Manage files', filePath: path.join(SKILLS_PATH, 'file-manager', 'SKILL.md'), isEnabled: true },
  { id: '3', name: 'disabled-skill', command: '/disabled', description: 'Disabled', filePath: path.join(SKILLS_PATH, 'disabled-skill', 'SKILL.md'), isEnabled: false },
];

function buildSystemPromptWithSkills(enabledSkills: Skill[]): string {
  const basePrompt = `<identity>You are Accomplish.</identity>`;
  if (enabledSkills.length === 0) return basePrompt;

  return basePrompt + `
<available-skills>
${enabledSkills.map(s => `- **${s.name}** (${s.command}): ${s.description}
  File: ${s.filePath}`).join('\n\n')}
</available-skills>`;
}

console.log('\n========== RUNNING TESTS ==========\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    if (fn()) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ ${name}: ${err}`);
    failed++;
  }
}

const enabledSkills = skills.filter(s => s.isEnabled);
const prompt = buildSystemPromptWithSkills(enabledSkills);

test('Only enabled skills appear in prompt', () => {
  return prompt.includes('browser-automation') && prompt.includes('file-manager') && !prompt.includes('disabled-skill');
});

test('Skill file paths are absolute', () => {
  return prompt.includes(TEST_DIR);
});

test('Skills section has correct XML format', () => {
  return prompt.includes('<available-skills>') && prompt.includes('</available-skills>');
});

test('No skills section when no skills enabled', () => {
  const emptyPrompt = buildSystemPromptWithSkills([]);
  return !emptyPrompt.includes('<available-skills>');
});

test('Skill content can be read from file path', () => {
  const browserSkill = enabledSkills.find(s => s.name === 'browser-automation');
  if (!browserSkill) return false;
  const content = fs.readFileSync(browserSkill.filePath, 'utf-8');
  return content.includes('Browser Automation');
});

test('Prompt has reasonable size', () => {
  return prompt.length / 4 < 2000;
});

// Cleanup
console.log('\n========== CLEANUP ==========');
fs.rmSync(TEST_DIR, { recursive: true });
console.log('Test directory cleaned up');

console.log(`\n========== RESULTS: ${passed} passed, ${failed} failed ==========\n`);
process.exit(failed > 0 ? 1 : 0);
