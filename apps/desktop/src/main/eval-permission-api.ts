/**
 * Eval Permission API Server
 *
 * HTTP servers that handle file permission and question requests programmatically
 * for eval mode. These replace the UI-based permission flow with automatic
 * approve/deny based on the configured mode.
 */

import http from 'http';
import fs from 'fs';
import type { PermissionRequest, FileOperation } from '@accomplish/shared';

// Use same ports as the regular permission servers
export const PERMISSION_API_PORT = 9226;
export const QUESTION_API_PORT = 9227;

// ============================================================================
// Types
// ============================================================================

export interface EvalPermissionConfig {
  mode: 'auto-approve' | 'auto-deny' | string; // string = allowlist path
  onPermissionRequest?: (request: PermissionRequest) => void;
}

interface AllowlistEntry {
  path?: string;
  pattern?: string;
  operation?: FileOperation;
}

interface Allowlist {
  allow: AllowlistEntry[];
}

// ============================================================================
// Allowlist Handling
// ============================================================================

/**
 * Load and parse an allowlist file.
 * Returns null if the file doesn't exist or is invalid.
 */
function loadAllowlist(path: string): Allowlist | null {
  try {
    const content = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(content);

    // Validate structure
    if (!data.allow || !Array.isArray(data.allow)) {
      console.error('[Eval Permission] Invalid allowlist format: missing "allow" array');
      return null;
    }

    return data as Allowlist;
  } catch (err) {
    console.error('[Eval Permission] Failed to load allowlist:', err);
    return null;
  }
}

/**
 * Check if a file operation is allowed by the allowlist.
 */
function isAllowedByList(
  allowlist: Allowlist,
  operation: string,
  filePath: string
): boolean {
  for (const entry of allowlist.allow) {
    // Check operation match (if specified)
    if (entry.operation && entry.operation !== operation) {
      continue;
    }

    // Check exact path match
    if (entry.path && entry.path === filePath) {
      return true;
    }

    // Check pattern match (glob-like)
    if (entry.pattern) {
      const regex = globToRegex(entry.pattern);
      if (regex.test(filePath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Convert a simple glob pattern to a regex.
 * Supports * and ** wildcards.
 */
function globToRegex(pattern: string): RegExp {
  // Escape special regex characters except * and ?
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexStr}$`);
}

// ============================================================================
// Permission Server
// ============================================================================

/**
 * Create and start the HTTP server for file permission requests.
 * In eval mode, permissions are handled programmatically based on the mode.
 */
export function startEvalPermissionServer(config: EvalPermissionConfig): http.Server {
  // Load allowlist if specified
  let allowlist: Allowlist | null = null;
  if (config.mode !== 'auto-approve' && config.mode !== 'auto-deny') {
    allowlist = loadAllowlist(config.mode);
    if (!allowlist) {
      console.warn('[Eval Permission] Failed to load allowlist, falling back to auto-deny');
    }
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only handle POST /permission
    if (req.method !== 'POST' || req.url !== '/permission') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: {
      operation?: string;
      filePath?: string;
      filePaths?: string[];
      targetPath?: string;
      contentPreview?: string;
    };

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate required fields
    if (!data.operation || (!data.filePath && (!data.filePaths || data.filePaths.length === 0))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'operation and either filePath or filePaths are required' }));
      return;
    }

    // Validate operation type
    const validOperations = ['create', 'delete', 'rename', 'move', 'modify', 'overwrite'];
    if (!validOperations.includes(data.operation)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid operation. Must be one of: ${validOperations.join(', ')}` }));
      return;
    }

    // Build permission request for tracking
    const permissionRequest: PermissionRequest = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      taskId: 'eval',
      type: 'file',
      fileOperation: data.operation as FileOperation,
      filePath: data.filePath,
      filePaths: data.filePaths,
      targetPath: data.targetPath,
      contentPreview: data.contentPreview?.substring(0, 500),
      createdAt: new Date().toISOString(),
    };

    // Notify callback
    config.onPermissionRequest?.(permissionRequest);

    // Determine whether to allow
    let allowed = false;

    if (config.mode === 'auto-approve') {
      allowed = true;
    } else if (config.mode === 'auto-deny') {
      allowed = false;
    } else if (allowlist) {
      // Check allowlist for each file path
      const pathsToCheck = data.filePaths || (data.filePath ? [data.filePath] : []);
      allowed = pathsToCheck.every(p => isAllowedByList(allowlist!, data.operation!, p));
    }

    console.log(`[Eval Permission] ${data.operation} on ${data.filePath || data.filePaths?.join(', ')}: ${allowed ? 'APPROVED' : 'DENIED'}`);

    // Respond immediately (no UI delay)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ allowed }));
  });

  server.listen(PERMISSION_API_PORT, '127.0.0.1', () => {
    console.log(`[Eval Permission] Server listening on port ${PERMISSION_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Eval Permission] Port ${PERMISSION_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Eval Permission] Server error:', error);
    }
  });

  return server;
}

// ============================================================================
// Question Server
// ============================================================================

/**
 * Create and start the HTTP server for question requests.
 * In eval mode, questions are auto-denied (no user interaction possible).
 */
export function startEvalQuestionServer(config: EvalPermissionConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only handle POST /question
    if (req.method !== 'POST' || req.url !== '/question') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: {
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    };

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate required fields
    if (!data.question) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'question is required' }));
      return;
    }

    console.log(`[Eval Question] Received question: "${data.question.substring(0, 100)}..."`);

    // In eval mode, questions are auto-denied or auto-approved based on config
    // For auto-approve, select the first option if available
    if (config.mode === 'auto-approve' && data.options && data.options.length > 0) {
      console.log(`[Eval Question] Auto-approving with first option: "${data.options[0].label}"`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        selectedOptions: data.multiSelect ? [data.options[0].label] : undefined,
        customText: !data.multiSelect ? data.options[0].label : undefined,
      }));
    } else {
      console.log(`[Eval Question] Auto-denying question`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ denied: true }));
    }
  });

  server.listen(QUESTION_API_PORT, '127.0.0.1', () => {
    console.log(`[Eval Question] Server listening on port ${QUESTION_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Eval Question] Port ${QUESTION_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Eval Question] Server error:', error);
    }
  });

  return server;
}
