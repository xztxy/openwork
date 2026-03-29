import * as fs from 'fs';
import * as path from 'path';
import type { Skill } from '../../common/types/skills.js';
import type { SkillsManagerOptions } from '../../types/skills-manager.js';
import {
  getAllSkills as dbGetAllSkills,
  getEnabledSkills as dbGetEnabledSkills,
  getSkillById as dbGetSkillById,
  upsertSkill as dbUpsertSkill,
  setSkillEnabled as dbSetSkillEnabled,
  deleteSkill as dbDeleteSkill,
} from '../../storage/repositories/skills.js';
import { createConsoleLogger } from '../../utils/logging.js';
import { addFromFile, addFromFolder, addFromUrl, scanDirectory } from './skill-importer.js';

const log = createConsoleLogger({ prefix: 'SkillsManager' });

export type { SkillsManagerOptions };

export class SkillsManager {
  private readonly bundledSkillsPath: string;
  private readonly userSkillsPath: string;
  private initialized = false;

  constructor(options: SkillsManagerOptions) {
    this.bundledSkillsPath = options.bundledSkillsPath;
    this.userSkillsPath = options.userSkillsPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('[SkillsManager] Initializing...');

    if (!fs.existsSync(this.userSkillsPath)) {
      fs.mkdirSync(this.userSkillsPath, { recursive: true });
    }

    await this.resync();

    this.initialized = true;
    log.info('[SkillsManager] Initialized');
  }

  async resync(): Promise<Skill[]> {
    log.info('[SkillsManager] Resyncing skills...');

    const existingSkills = this.getAllSkills();
    const existingById = new Map(existingSkills.map((s) => [s.id, s]));
    const existingByPath = new Map(existingSkills.map((s) => [s.filePath, s]));

    const bundledSkills = scanDirectory(this.bundledSkillsPath, 'official');
    const userSkills = scanDirectory(this.userSkillsPath, 'custom');

    const allFoundSkills = [...bundledSkills, ...userSkills];
    const processedPaths = new Set<string>();

    for (const skill of allFoundSkills) {
      if (processedPaths.has(skill.filePath)) {
        continue;
      }
      processedPaths.add(skill.filePath);

      const existingByFilePath = existingByPath.get(skill.filePath);
      if (existingByFilePath) {
        skill.id = existingByFilePath.id;
        skill.isEnabled = existingByFilePath.isEnabled;
        if (existingByFilePath.githubUrl) {
          skill.source = existingByFilePath.source;
          skill.githubUrl = existingByFilePath.githubUrl;
        }
      } else {
        const existingById_ = existingById.get(skill.id);
        if (existingById_) {
          skill.isEnabled = existingById_.isEnabled;
        }
      }

      dbUpsertSkill(skill);
    }

    for (const existingSkill of existingSkills) {
      if (!processedPaths.has(existingSkill.filePath)) {
        log.info(
          `[SkillsManager] Removing stale skill: ${existingSkill.name} (${existingSkill.filePath})`,
        );
        dbDeleteSkill(existingSkill.id);
      }
    }

    log.info(`[SkillsManager] Synced ${allFoundSkills.length} skills`);

    return this.getAllSkills();
  }

  getAllSkills(): Skill[] {
    return dbGetAllSkills();
  }

  getEnabledSkills(): Skill[] {
    return dbGetEnabledSkills();
  }

  getSkillById(skillId: string): Skill | null {
    return dbGetSkillById(skillId);
  }

  setSkillEnabled(skillId: string, enabled: boolean): void {
    dbSetSkillEnabled(skillId, enabled);
  }

  getSkillContent(skillId: string): string | null {
    const skill = this.getSkillById(skillId);
    if (!skill) return null;

    try {
      return fs.readFileSync(skill.filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async addSkill(sourcePath: string): Promise<Skill | null> {
    if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
      return addFromUrl(sourcePath, this.userSkillsPath);
    }

    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      return addFromFolder(sourcePath, this.userSkillsPath);
    }

    return addFromFile(sourcePath, this.userSkillsPath);
  }

  deleteSkill(skillId: string): boolean {
    const skill = this.getSkillById(skillId);
    if (!skill) {
      return false;
    }

    if (skill.source === 'official') {
      log.warn('[SkillsManager] Cannot delete official skills');
      return false;
    }

    const skillDir = path.dirname(skill.filePath);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }

    dbDeleteSkill(skillId);
    return true;
  }
}
