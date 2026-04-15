import { describe, expect, it } from 'vitest';
import { validateTaskConfig } from '../../../src/utils/task-validation.js';
import type { TaskConfig, FileAttachmentInfo } from '../../../src/common/types/task.js';

describe('validateTaskConfig', () => {
  it('preserves files array on the validated config', () => {
    const files: FileAttachmentInfo[] = [
      {
        id: 'att-1',
        name: 'readme.md',
        path: '/tmp/readme.md',
        type: 'text',
        size: 1024,
        content: '# Hello',
      },
    ];
    const config: TaskConfig = {
      prompt: 'Summarize the file',
      files,
    };

    const validated = validateTaskConfig(config);
    expect(validated.files).toEqual(files);
  });

  it('preserves modelId on the validated config', () => {
    const config: TaskConfig = {
      prompt: 'Do something',
      modelId: 'claude-sonnet',
    };

    const validated = validateTaskConfig(config);
    expect(validated.modelId).toBe('claude-sonnet');
  });

  it('omits files when none are provided', () => {
    const config: TaskConfig = { prompt: 'No files here' };
    const validated = validateTaskConfig(config);
    expect(validated.files).toBeUndefined();
  });

  it('omits files when array is empty', () => {
    const config: TaskConfig = { prompt: 'Empty files', files: [] };
    const validated = validateTaskConfig(config);
    expect(validated.files).toBeUndefined();
  });

  it('preserves multiple files', () => {
    const files: FileAttachmentInfo[] = [
      { id: 'a', name: 'a.txt', path: '/a.txt', type: 'text', size: 100 },
      { id: 'b', name: 'b.png', path: '/b.png', type: 'image', size: 200 },
    ];
    const config: TaskConfig = { prompt: 'Two files', files };
    const validated = validateTaskConfig(config);
    expect(validated.files).toHaveLength(2);
  });

  it('preserves source=ui through validation', () => {
    const config: TaskConfig = { prompt: 'UI task', source: 'ui' };
    const validated = validateTaskConfig(config);
    expect(validated.source).toBe('ui');
  });

  it('preserves source=whatsapp through validation', () => {
    const config: TaskConfig = { prompt: 'WA task', source: 'whatsapp' };
    const validated = validateTaskConfig(config);
    expect(validated.source).toBe('whatsapp');
  });

  it('preserves source=scheduler through validation', () => {
    const config: TaskConfig = { prompt: 'Scheduled task', source: 'scheduler' };
    const validated = validateTaskConfig(config);
    expect(validated.source).toBe('scheduler');
  });

  it('omits source when not provided (defaults at consumer)', () => {
    const config: TaskConfig = { prompt: 'No source' };
    const validated = validateTaskConfig(config);
    expect(validated.source).toBeUndefined();
  });

  it('drops unknown source values (sanity guard beyond Zod)', () => {
    const config = { prompt: 'Bad source', source: 'pirate' } as unknown as TaskConfig;
    const validated = validateTaskConfig(config);
    expect(validated.source).toBeUndefined();
  });
});
