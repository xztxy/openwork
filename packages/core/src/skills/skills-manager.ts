/**
 * Skills Manager for @accomplish/core
 *
 * Platform-independent skills management. Discovers, syncs, and manages
 * skill files (markdown with frontmatter) to a SQLite database.
 *
 * This module is free of Electron dependencies - paths and database
 * are provided via configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import type { Database } from 'better-sqlite3';
import type { Skill, SkillSource, SkillFrontmatter } from '@accomplish/shared';

/**
 * Database row type for skills table
 */
interface SkillRow {
  id: string;
  name: string;
  command: string;
  description: string;
  source: string;
  is_enabled: number;
  is_verified: number;
  is_hidden: number;
  file_path: string;
  github_url: string | null;
  updated_at: string;
}

/**
 * Configuration options for SkillsManager
 */
export interface SkillsManagerOptions {
  /** Path to bundled (official) skills directory */
  bundledSkillsPath: string;
  /** Path to user skills directory */
  userSkillsPath: string;
  /** SQLite database instance */
  database: Database;
}

/**
 * Convert a database row to a Skill object
 */
function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    description: row.description,
    source: row.source as SkillSource,
    isEnabled: row.is_enabled === 1,
    isVerified: row.is_verified === 1,
    isHidden: row.is_hidden === 1,
    filePath: row.file_path,
    githubUrl: row.github_url || undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Manages skill discovery, persistence, and lifecycle.
 *
 * Skills are markdown files with YAML frontmatter containing metadata
 * like name, description, and command. They can be:
 * - Official (bundled): Shipped with the app
 * - Community: Downloaded from GitHub
 * - Custom: User-created or added from local files
 */
export class SkillsManager {
  private readonly bundledSkillsPath: string;
  private readonly userSkillsPath: string;
  private readonly db: Database;
  private initialized = false;

  constructor(options: SkillsManagerOptions) {
    this.bundledSkillsPath = options.bundledSkillsPath;
    this.userSkillsPath = options.userSkillsPath;
    this.db = options.database;
  }

  /**
   * Initialize the skills manager.
   * Creates the user skills directory if it doesn't exist and performs initial sync.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[SkillsManager] Initializing...');

    // Ensure user skills directory exists
    if (!fs.existsSync(this.userSkillsPath)) {
      fs.mkdirSync(this.userSkillsPath, { recursive: true });
    }

    await this.resync();

    this.initialized = true;
    console.log('[SkillsManager] Initialized');
  }

  /**
   * Resync skills from disk to database.
   * Scans bundled and user directories, upserts found skills,
   * and removes stale entries for skills no longer on disk.
   *
   * @returns Array of all discovered skills
   */
  async resync(): Promise<Skill[]> {
    console.log('[SkillsManager] Resyncing skills...');

    const existingSkills = this.getAllSkills();
    const existingById = new Map(existingSkills.map((s) => [s.id, s]));
    const existingByPath = new Map(existingSkills.map((s) => [s.filePath, s]));

    const bundledSkills = this.scanDirectory(this.bundledSkillsPath, 'official');
    const userSkills = this.scanDirectory(this.userSkillsPath, 'custom');

    const allFoundSkills = [...bundledSkills, ...userSkills];
    const processedPaths = new Set<string>();

    for (const skill of allFoundSkills) {
      // Skip if we've already processed this file path (prevents duplicates)
      if (processedPaths.has(skill.filePath)) {
        continue;
      }
      processedPaths.add(skill.filePath);

      // Check if skill already exists by file path
      const existingByFilePath = existingByPath.get(skill.filePath);
      if (existingByFilePath) {
        // Always preserve existing ID to prevent duplicates when name changes
        skill.id = existingByFilePath.id;
        skill.isEnabled = existingByFilePath.isEnabled;
        // Preserve GitHub-specific metadata if it was imported from GitHub
        if (existingByFilePath.githubUrl) {
          skill.source = existingByFilePath.source;
          skill.githubUrl = existingByFilePath.githubUrl;
        }
      } else {
        // Check by ID for backwards compatibility
        const existingById_ = existingById.get(skill.id);
        if (existingById_) {
          skill.isEnabled = existingById_.isEnabled;
        }
      }

      this.upsertSkill(skill);
    }

    // Remove stale DB entries for skills that no longer exist on disk
    for (const existingSkill of existingSkills) {
      if (!processedPaths.has(existingSkill.filePath)) {
        console.log(
          `[SkillsManager] Removing stale skill: ${existingSkill.name} (${existingSkill.filePath})`
        );
        this.deleteSkillFromDb(existingSkill.id);
      }
    }

    console.log(`[SkillsManager] Synced ${allFoundSkills.length} skills`);

    return this.getAllSkills();
  }

  /**
   * Get all skills from the database.
   */
  getAllSkills(): Skill[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY name').all() as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Get only enabled skills from the database.
   */
  getEnabledSkills(): Skill[] {
    const rows = this.db
      .prepare('SELECT * FROM skills WHERE is_enabled = 1 ORDER BY name')
      .all() as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Get a skill by its ID.
   */
  getSkillById(skillId: string): Skill | null {
    const row = this.db
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(skillId) as SkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  /**
   * Set whether a skill is enabled or disabled.
   */
  setSkillEnabled(skillId: string, enabled: boolean): void {
    this.db.prepare('UPDATE skills SET is_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, skillId);
  }

  /**
   * Get the raw content of a skill file.
   *
   * @returns The file content, or null if skill not found or file unreadable
   */
  getSkillContent(skillId: string): string | null {
    const skill = this.getSkillById(skillId);
    if (!skill) return null;

    try {
      return fs.readFileSync(skill.filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Add a skill from a local file path.
   * Copies the file to the user skills directory.
   *
   * @param sourcePath - Path to the SKILL.md file to import
   * @returns The created skill, or null if import failed
   */
  async addSkill(sourcePath: string): Promise<Skill | null> {
    // Check if it's a URL (GitHub)
    if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
      return this.addFromUrl(sourcePath);
    }

    return this.addFromFile(sourcePath);
  }

  /**
   * Delete a user skill.
   * Only custom and community skills can be deleted, not official ones.
   *
   * @returns true if deleted, false if skill not found or is official
   */
  deleteSkill(skillId: string): boolean {
    const skill = this.getSkillById(skillId);
    if (!skill) {
      return false;
    }

    if (skill.source === 'official') {
      console.warn('[SkillsManager] Cannot delete official skills');
      return false;
    }

    // Delete the skill directory
    const skillDir = path.dirname(skill.filePath);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }

    this.deleteSkillFromDb(skillId);
    return true;
  }

  // ============ Private Methods ============

  /**
   * Scan a directory for skills.
   * Looks for subdirectories containing SKILL.md files.
   */
  private scanDirectory(dirPath: string, defaultSource: SkillSource): Skill[] {
    const skills: Skill[] = [];

    if (!fs.existsSync(dirPath)) {
      return skills;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const frontmatter = this.parseFrontmatter(content);

        const name = frontmatter.name || entry.name;
        const source = defaultSource;
        const id = this.generateId(name, source);
        // Use sanitized name for default command to avoid spaces/special chars
        const safeName = name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        skills.push({
          id,
          name,
          command: frontmatter.command || `/${safeName}`,
          description: frontmatter.description || '',
          source,
          isEnabled: true,
          isVerified: frontmatter.verified || false,
          isHidden: frontmatter.hidden || false,
          filePath: skillMdPath,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`[SkillsManager] Failed to parse ${skillMdPath}:`, err);
      }
    }

    return skills;
  }

  /**
   * Parse YAML frontmatter from a skill markdown file.
   */
  private parseFrontmatter(content: string): SkillFrontmatter {
    try {
      const { data } = matter(content);
      return {
        name: data.name || '',
        description: data.description || '',
        command: data.command,
        verified: data.verified,
        hidden: data.hidden,
      };
    } catch {
      return { name: '', description: '' };
    }
  }

  /**
   * Generate a unique ID for a skill based on name and source.
   */
  private generateId(name: string, source: SkillSource): string {
    const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `${source}-${safeName}`;
  }

  /**
   * Sanitize a skill name to prevent path traversal attacks.
   * Removes dangerous characters and path components.
   */
  private sanitizeSkillName(name: string): string {
    return name
      .replace(/\.\./g, '') // Remove parent directory references
      .replace(/[/\\]/g, '-') // Replace path separators with dashes
      .replace(/[^a-zA-Z0-9-_\s]/g, '-') // Only allow safe characters
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-') // Collapse multiple dashes
      .replace(/^-|-$/g, '') // Trim leading/trailing dashes
      .trim();
  }

  /**
   * Verify that a path is within the expected directory.
   * Prevents path traversal attacks.
   */
  private isPathWithinDirectory(filePath: string, directory: string): boolean {
    const resolved = path.resolve(filePath);
    const resolvedDir = path.resolve(directory);
    return resolved.startsWith(resolvedDir + path.sep);
  }

  /**
   * Add a skill from a local file.
   */
  private async addFromFile(sourcePath: string): Promise<Skill> {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    const frontmatter = this.parseFrontmatter(content);

    if (!frontmatter.name) {
      throw new Error('SKILL.md must have a name in frontmatter');
    }

    // Sanitize skill name to prevent path traversal
    const safeName = this.sanitizeSkillName(frontmatter.name);
    if (!safeName) {
      throw new Error('Invalid skill name');
    }

    const skillDir = path.join(this.userSkillsPath, safeName);

    // Verify the path stays within the skills directory
    if (!this.isPathWithinDirectory(skillDir, this.userSkillsPath)) {
      throw new Error('Invalid skill name: path traversal detected');
    }

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const destPath = path.join(skillDir, 'SKILL.md');
    fs.copyFileSync(sourcePath, destPath);

    const skill: Skill = {
      id: this.generateId(safeName, 'custom'),
      name: frontmatter.name, // Keep original name for display
      command: frontmatter.command || `/${safeName}`,
      description: frontmatter.description || '',
      source: 'custom',
      isEnabled: true,
      isVerified: false,
      isHidden: false,
      filePath: destPath,
      updatedAt: new Date().toISOString(),
    };

    this.upsertSkill(skill);
    return skill;
  }

  /**
   * Add a skill from a URL (GitHub).
   */
  private async addFromUrl(rawUrl: string): Promise<Skill> {
    // Validate URL with strict host allowlist to prevent SSRF attacks
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error('Invalid URL format');
    }

    const allowedHosts = ['github.com', 'raw.githubusercontent.com'];
    if (!allowedHosts.includes(parsedUrl.hostname)) {
      throw new Error('URL must be from github.com or raw.githubusercontent.com');
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new Error('URL must use HTTPS');
    }

    let fetchUrl = rawUrl;
    if (rawUrl.includes('github.com') && !rawUrl.includes('raw.githubusercontent.com')) {
      // Handle directory URLs (/tree/) - append SKILL.md
      if (rawUrl.includes('/tree/')) {
        fetchUrl = rawUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/tree/', '/');
        // If URL doesn't end with SKILL.md, append it
        if (!fetchUrl.endsWith('SKILL.md')) {
          fetchUrl = fetchUrl.replace(/\/?$/, '/SKILL.md');
        }
      } else if (rawUrl.includes('/blob/')) {
        // Handle file URLs (/blob/)
        fetchUrl = rawUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      } else {
        // Try to construct a raw URL assuming it's a path
        fetchUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com');
        if (!fetchUrl.endsWith('SKILL.md')) {
          fetchUrl = fetchUrl.replace(/\/?$/, '/SKILL.md');
        }
      }
    }

    console.log('[SkillsManager] Fetching from:', fetchUrl);

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const content = await response.text();

    const frontmatter = this.parseFrontmatter(content);

    if (!frontmatter.name) {
      throw new Error('SKILL.md must have a name in frontmatter');
    }

    // Sanitize skill name to prevent path traversal
    const safeName = this.sanitizeSkillName(frontmatter.name);
    if (!safeName) {
      throw new Error('Invalid skill name');
    }

    const skillDir = path.join(this.userSkillsPath, safeName);

    // Verify the path stays within the skills directory
    if (!this.isPathWithinDirectory(skillDir, this.userSkillsPath)) {
      throw new Error('Invalid skill name: path traversal detected');
    }

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const destPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(destPath, content);

    const skill: Skill = {
      id: this.generateId(safeName, 'community'),
      name: frontmatter.name, // Keep original name for display
      command: frontmatter.command || `/${safeName}`,
      description: frontmatter.description || '',
      source: 'community',
      isEnabled: true,
      isVerified: false,
      isHidden: false,
      filePath: destPath,
      githubUrl: rawUrl,
      updatedAt: new Date().toISOString(),
    };

    this.upsertSkill(skill);
    return skill;
  }

  /**
   * Upsert a skill to the database.
   */
  private upsertSkill(skill: Skill): void {
    this.db
      .prepare(
        `
      INSERT INTO skills (id, name, command, description, source, is_enabled, is_verified, is_hidden, file_path, github_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        command = excluded.command,
        description = excluded.description,
        is_enabled = excluded.is_enabled,
        is_verified = excluded.is_verified,
        is_hidden = excluded.is_hidden,
        file_path = excluded.file_path,
        github_url = excluded.github_url,
        updated_at = excluded.updated_at
    `
      )
      .run(
        skill.id,
        skill.name,
        skill.command,
        skill.description,
        skill.source,
        skill.isEnabled ? 1 : 0,
        skill.isVerified ? 1 : 0,
        skill.isHidden ? 1 : 0,
        skill.filePath,
        skill.githubUrl || null,
        skill.updatedAt
      );
  }

  /**
   * Delete a skill from the database.
   */
  private deleteSkillFromDb(skillId: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(skillId);
  }
}
