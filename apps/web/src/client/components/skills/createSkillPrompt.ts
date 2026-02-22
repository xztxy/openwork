interface BuildCreateSkillPromptParams {
  name: string;
  description: string;
  skillsBasePath: string;
}

const FALLBACK_SKILL_DIR_NAME = 'new-skill';

function trimTrailingSeparator(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function joinSkillPath(basePath: string, skillDirectory: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${trimTrailingSeparator(basePath)}${separator}${skillDirectory}${separator}SKILL.md`;
}

export function sanitizeSkillDirectoryName(name: string): string {
  const sanitized = name
    .replace(/\.\./g, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9-_\s]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim()
    .toLowerCase();

  return sanitized || FALLBACK_SKILL_DIR_NAME;
}

export function buildCreateSkillPrompt({
  name,
  description,
  skillsBasePath,
}: BuildCreateSkillPromptParams): string {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const normalizedBasePath = trimTrailingSeparator(skillsBasePath.trim());
  const skillDirectoryName = sanitizeSkillDirectoryName(trimmedName);
  const skillFilePath = joinSkillPath(normalizedBasePath, skillDirectoryName);

  return [
    '/skill-creator',
    '',
    'Create one custom skill with these inputs:',
    `- Name: ${JSON.stringify(trimmedName)}`,
    `- Description: ${JSON.stringify(trimmedDescription)}`,
    '',
    'Deterministic write contract (mandatory):',
    `1. Use this exact base directory: ${JSON.stringify(normalizedBasePath)}`,
    `2. Use this exact skill directory name: ${JSON.stringify(skillDirectoryName)}`,
    `3. Write exactly one skill file at: ${JSON.stringify(skillFilePath)}`,
    `4. Do not create skill files outside ${JSON.stringify(normalizedBasePath)}`,
    '5. If the file already exists, overwrite it.',
    '',
    'Verification (mandatory):',
    `1. Read ${JSON.stringify(skillFilePath)} after writing.`,
    '2. Confirm frontmatter contains non-empty name and description.',
    `3. End your final message with exactly: Created skill at: ${skillFilePath}`,
  ].join('\n');
}
