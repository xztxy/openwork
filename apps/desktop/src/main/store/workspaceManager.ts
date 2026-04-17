import {
  createDefaultWorkspace,
  createWorkspaceRecord,
  updateWorkspaceRecord,
  deleteWorkspaceRecord,
  listWorkspaces,
  getWorkspace,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from '@accomplish_ai/agent-core';
import type {
  Workspace,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
} from '@accomplish_ai/agent-core';
import { getLogCollector } from '../logging';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'main', msg, data);
    }
  } catch (_e) {
    /* best-effort logging */
  }
}

let _activeWorkspaceId: string | null = null;
let _initialized = false;

export function isInitialized(): boolean {
  return _initialized;
}

export function getActiveWorkspace(): string | null {
  return _activeWorkspaceId;
}

/**
 * Initialize the workspace system.
 * Ensures a default workspace exists and resolves the active workspace id.
 * The workspaces/workspace_meta/knowledge_notes tables now live in the main
 * DB (consolidated in v030), so this function no longer opens a second SQLite
 * handle — the caller is expected to have already initialized the main DB
 * via `initializeStorage()`.
 */
export function initialize(): void {
  log('INFO', '[WorkspaceManager] Initializing...');

  try {
    // Ensure default workspace exists
    const defaultWorkspace = createDefaultWorkspace();
    log('INFO', `[WorkspaceManager] Default workspace: ${defaultWorkspace.id}`);

    // Get the active workspace (or fall back to default)
    let activeId = getActiveWorkspaceId();
    if (!activeId || !getWorkspace(activeId)) {
      activeId = defaultWorkspace.id;
      setActiveWorkspaceId(activeId);
    }

    _activeWorkspaceId = activeId;
    _initialized = true;

    log('INFO', `[WorkspaceManager] Initialized with active workspace: ${activeId}`);
  } catch (err) {
    log('ERROR', '[WorkspaceManager] Initialization failed', { err: String(err) });
    _activeWorkspaceId = null;
    throw err;
  }
}

export function switchWorkspace(workspaceId: string): boolean {
  if (workspaceId === _activeWorkspaceId) {
    return false;
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  log('INFO', `[WorkspaceManager] Switching to workspace: ${workspace.name} (${workspaceId})`);

  _activeWorkspaceId = workspaceId;
  setActiveWorkspaceId(workspaceId);
  return true;
}

export function createWorkspace(input: WorkspaceCreateInput): Workspace {
  return createWorkspaceRecord(input);
}

export function updateWorkspace(id: string, input: WorkspaceUpdateInput): Workspace | null {
  return updateWorkspaceRecord(id, input);
}

export function deleteWorkspace(id: string): boolean {
  const workspace = getWorkspace(id);
  if (!workspace || workspace.isDefault) {
    return false;
  }

  // If deleting the active workspace, switch to default first
  if (_activeWorkspaceId === id) {
    const allWorkspaces = listWorkspaces();
    const defaultWs = allWorkspaces.find((w) => w.isDefault);
    const fallbackId = defaultWs
      ? defaultWs.id
      : (allWorkspaces.find((w) => w.id !== id)?.id ?? null);
    _activeWorkspaceId = fallbackId;
    if (fallbackId) {
      setActiveWorkspaceId(fallbackId);
    }
  }

  return deleteWorkspaceRecord(id);
}

export { listWorkspaces, getWorkspace };

export function close(): void {
  log('INFO', '[WorkspaceManager] Closing...');
  // The workspace tables now share the main DB; closing the main DB is the
  // caller's responsibility (via `closeStorage()`). Nothing DB-specific to
  // tear down here.
  _activeWorkspaceId = null;
  _initialized = false;
}
