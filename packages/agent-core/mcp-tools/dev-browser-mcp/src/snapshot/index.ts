import { SnapshotManager } from './manager.js';

const managers = new Map<string, SnapshotManager>();

export function getSnapshotManager(pageId?: string): SnapshotManager {
  const key = pageId ?? 'default';
  if (!managers.has(key)) {
    managers.set(key, new SnapshotManager());
  }
  return managers.get(key)!;
}

export function resetSnapshotManager(pageId?: string): void {
  const key = pageId ?? 'default';
  managers.get(key)?.reset();
  managers.delete(key);
}
