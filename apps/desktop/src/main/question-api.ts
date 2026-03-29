/**
 * Question API Server
 *
 * HTTP server that the question MCP server calls to request
 * answers from the user. This bridges the MCP server
 * (separate process) with the Electron UI.
 */

import http from 'http';
import type { BrowserWindow } from 'electron';
import {
  QUESTION_API_PORT,
  type PermissionHandlerAPI,
  type PermissionQuestionRequestData as QuestionRequestData,
} from '@accomplish_ai/agent-core';
import { getLogCollector } from './logging';
import { parseJsonRequest, resolveTaskIdFromRequest, setCorsHeaders } from './permission-api-utils';

/**
 * Create and start the HTTP server for question requests.
 * Accepts getter functions so that the current window/taskId are resolved
 * at request time rather than at startup (avoids stale captures).
 */
export function startQuestionApiServer(
  permissionHandler: PermissionHandlerAPI,
  getMainWindow: () => BrowserWindow | null,
  getActiveTaskId: () => string | null,
): http.Server {
  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res, req);

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/question') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const parsed = await parseJsonRequest(req, res);
    if (!parsed) {
      return;
    }

    const requestTaskId = parsed.taskId;
    const data = parsed as QuestionRequestData;

    const validation = permissionHandler.validateQuestionRequest(data);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: validation.error }));
      return;
    }

    const currentWindow = getMainWindow();
    if (!currentWindow || currentWindow.isDestroyed()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Question API not initialized' }));
      return;
    }

    const { taskId, error } = resolveTaskIdFromRequest(requestTaskId, getActiveTaskId);
    if (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
      return;
    }

    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active task' }));
      return;
    }

    const { requestId, promise } = permissionHandler.createQuestionRequest();
    currentWindow.webContents.send(
      'permission:request',
      permissionHandler.buildQuestionRequest(requestId, taskId, data),
    );

    try {
      const response = await promise;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (_error) {
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out', denied: true }));
    }
  });

  server.listen(QUESTION_API_PORT, '127.0.0.1', () => {
    getLogCollector().logEnv(
      'INFO',
      `[Question API] Server listening on port ${QUESTION_API_PORT}`,
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      getLogCollector().logEnv(
        'WARN',
        `[Question API] Port ${QUESTION_API_PORT} already in use, skipping server start`,
      );
    } else {
      getLogCollector().logEnv('ERROR', '[Question API] Server error:', { error: String(error) });
    }
  });

  return server;
}
