import { describe, expect, it } from 'vitest';
import { buildCreateSkillPrompt } from '@/components/skills/createSkillPrompt';

describe('createSkillPrompt', () => {
  describe('buildCreateSkillPrompt', () => {
    it('pins only the deterministic base path for unix paths', () => {
      const prompt = buildCreateSkillPrompt({
        name: 'My Skill',
        description: 'Does useful work',
        skillsBasePath: '/Users/test/Library/Application Support/Accomplish/skills/',
        platform: 'darwin',
      });

      expect(prompt).toContain('/skill-creator');
      expect(prompt).toContain(
        'Use this exact base directory: `/Users/test/Library/Application Support/Accomplish/skills`',
      );
      expect(prompt).toContain(
        'Create exactly one new subdirectory under that base directory for this skill.',
      );
      expect(prompt).toContain(
        'End your final message with exactly: Created skill at: <absolute path to SKILL.md>',
      );
      expect(prompt).not.toContain('Use this exact skill directory name');
      expect(prompt).not.toContain('/my-skill/SKILL.md');
    });

    it('normalizes windows base path when platform is win32', () => {
      const prompt = buildCreateSkillPrompt({
        name: 'Windows Skill',
        description: 'Works on Windows',
        skillsBasePath: 'C:/Users/Test/AppData/Roaming/Accomplish/skills/',
        platform: 'win32',
      });

      expect(prompt).toContain(
        'Use this exact base directory: `C:\\Users\\Test\\AppData\\Roaming\\Accomplish\\skills`',
      );
      expect(prompt).not.toContain('C:\\\\Users');
    });

    it('accepts non-ascii skill names without enforcing a fixed slug', () => {
      const prompt = buildCreateSkillPrompt({
        name: 'שלום',
        description: 'Does useful work',
        skillsBasePath: '/Users/test/Library/Application Support/Accomplish/skills/',
        platform: 'darwin',
      });

      expect(prompt).toContain('- Name: "שלום"');
      expect(prompt).not.toContain('Use this exact skill directory name');
    });
  });
});
