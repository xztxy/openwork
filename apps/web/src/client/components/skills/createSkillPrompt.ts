interface BuildCreateSkillPromptParams {
  name: string;
  description: string;
  skillsBasePath: string;
  platform?: string;
}

const FALLBACK_SKILL_DIR_NAME = 'new-skill';
const SKILL_HASH_SEED = 0;

function cyrb53(input: string, seed = SKILL_HASH_SEED): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0; i < input.length; i += 1) {
    const charCode = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ charCode, 2654435761);
    h2 = Math.imul(h2 ^ charCode, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function createHashedFallbackSkillDirectoryName(input: string): string {
  const hash = cyrb53(input, SKILL_HASH_SEED);
  const suffix = hash.toString(36).padStart(10, '0').slice(-10);
  return `${FALLBACK_SKILL_DIR_NAME}-${suffix}`;
}

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
  const normalized = name.normalize('NFKC').trim().toLowerCase();

  const sanitized = normalized
    .replace(/\.\./g, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9-_\s]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();

  if (sanitized) {
    return sanitized;
  }

  return createHashedFallbackSkillDirectoryName(normalized);
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
