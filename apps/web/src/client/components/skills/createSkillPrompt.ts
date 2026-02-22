interface BuildCreateSkillPromptParams {
  name: string;
  description: string;
  skillsBasePath: string;
  platform?: string;
}

const FALLBACK_SKILL_DIR_NAME = 'new-skill';

function trimTrailingSeparator(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function getPathSeparator(basePath: string, platform?: string): '\\' | '/' {
  if (platform === 'win32') return '\\';
  if (platform === 'darwin' || platform === 'linux') return '/';
  return basePath.includes('\\') ? '\\' : '/';
}

function normalizeBasePath(basePath: string, platform?: string): string {
  const trimmed = trimTrailingSeparator(basePath.trim());
  if (platform === 'win32') {
    return trimmed.replace(/\//g, '\\');
  }
  if (platform === 'darwin' || platform === 'linux') {
    return trimmed.replace(/\\/g, '/');
  }
  return trimmed;
}

function joinSkillPath(basePath: string, skillDirectory: string, platform?: string): string {
  const separator = getPathSeparator(basePath, platform);
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
  platform,
}: BuildCreateSkillPromptParams): string {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const normalizedBasePath = normalizeBasePath(skillsBasePath, platform);
  const skillDirectoryName = sanitizeSkillDirectoryName(trimmedName);
  const skillFilePath = joinSkillPath(normalizedBasePath, skillDirectoryName, platform);

  return [
    '/skill-creator',
    '',
    'Create one custom skill with these inputs:',
    `- Name: ${JSON.stringify(trimmedName)}`,
    `- Description: ${JSON.stringify(trimmedDescription)}`,
    '',
    'Deterministic write contract (mandatory):',
    `1. Use this exact base directory: \`${normalizedBasePath}\``,
    `2. Use this exact skill directory name: ${JSON.stringify(skillDirectoryName)}`,
    `3. Write exactly one skill file at: \`${skillFilePath}\``,
    `4. Do not create skill files outside \`${normalizedBasePath}\``,
    '5. If the file already exists, overwrite it.',
    '',
    'Verification (mandatory):',
    `1. Read \`${skillFilePath}\` after writing.`,
    '2. Confirm frontmatter contains non-empty name and description.',
    `3. End your final message with exactly: Created skill at: ${skillFilePath}`,
  ].join('\n');
}
