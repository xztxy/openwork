import { describe, expect, it } from 'vitest';
import {
  buildCreateSkillPrompt,
  sanitizeSkillDirectoryName,
} from '@/components/skills/createSkillPrompt';

describe('createSkillPrompt', () => {
  describe('sanitizeSkillDirectoryName', () => {
    it('creates lowercase hyphenated directory names', () => {
      expect(sanitizeSkillDirectoryName('My Awesome Skill')).toBe('my-awesome-skill');
    });

    it('removes traversal and unsafe characters', () => {
      expect(sanitizeSkillDirectoryName('../../../etc/passwd')).toBe('etc-passwd');
    });

    it('falls back when name is fully sanitized away', () => {
      expect(sanitizeSkillDirectoryName('🔥🔥🔥')).toBe('new-skill');
    });
  });

  describe('buildCreateSkillPrompt', () => {
    it('injects exact base and target paths for unix paths', () => {
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
        'Write exactly one skill file at: `/Users/test/Library/Application Support/Accomplish/skills/my-skill/SKILL.md`',
      );
      expect(prompt).toContain(
        'End your final message with exactly: Created skill at: /Users/test/Library/Application Support/Accomplish/skills/my-skill/SKILL.md',
      );
    });

    it('uses windows separators when platform is win32', () => {
      const prompt = buildCreateSkillPrompt({
        name: 'Windows Skill',
        description: 'Works on Windows',
        skillsBasePath: 'C:/Users/Test/AppData/Roaming/Accomplish/skills/',
        platform: 'win32',
      });

      expect(prompt).toContain(
        'Use this exact base directory: `C:\\Users\\Test\\AppData\\Roaming\\Accomplish\\skills`',
      );
      expect(prompt).toContain(
        'Write exactly one skill file at: `C:\\Users\\Test\\AppData\\Roaming\\Accomplish\\skills\\windows-skill\\SKILL.md`',
      );
      expect(prompt).toContain(
        'End your final message with exactly: Created skill at: C:\\Users\\Test\\AppData\\Roaming\\Accomplish\\skills\\windows-skill\\SKILL.md',
      );
      expect(prompt).not.toContain('C:\\\\Users');
    });
  });
});
