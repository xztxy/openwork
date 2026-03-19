import path from 'path';
import fs from 'fs';
import { BrowserWindow, dialog, app } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { getLogCollector } from '../../logging';
import { getStorage } from '../../store/storage';
import { handle, assertTrustedWindow } from './utils';

export function registerDebugHandlers(): void {
  const storage = getStorage();

  const assertDebugModeEnabled = () => {
    if (!storage.getDebugMode()) {
      throw new Error('Debug mode is disabled');
    }
  };

  handle('logs:export', async (event: IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('No window found');

    const collector = getLogCollector();
    collector.flush();

    const logPath = collector.getCurrentLogPath();
    const logDir = collector.getLogDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultFilename = `accomplish-logs-${timestamp}.txt`;

    const result = await dialog.showSaveDialog(window, {
      title: 'Export Application Logs',
      defaultPath: defaultFilename,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'Log Files', extensions: ['log'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, reason: 'cancelled' };
    }

    try {
      if (fs.existsSync(logPath)) {
        fs.copyFileSync(logPath, result.filePath);
      } else {
        const header = `Accomplish Application Logs\nExported: ${new Date().toISOString()}\nLog Directory: ${logDir}\n\nNo logs recorded yet.\n`;
        fs.writeFileSync(result.filePath, header);
      }

      return { success: true, path: result.filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  handle(
    'log:event',
    async (
      _event: IpcMainInvokeEvent,
      _payload: { level?: string; message?: string; context?: Record<string, unknown> },
    ) => {
      return { ok: true };
    },
  );

  handle('debug:capture-screenshot', async (event: IpcMainInvokeEvent) => {
    try {
      assertDebugModeEnabled();
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
    let window: BrowserWindow;
    try {
      window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Untrusted window';
      return { success: false, error: message };
    }
    try {
      const image = await window.webContents.capturePage();
      const pngBuffer = image.toPNG();
      const base64 = pngBuffer.toString('base64');
      const size = image.getSize();
      return { success: true, data: base64, width: size.width, height: size.height };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  handle('debug:capture-axtree', async (event: IpcMainInvokeEvent) => {
    try {
      assertDebugModeEnabled();
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
    let window: BrowserWindow;
    try {
      window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Untrusted window';
      return { success: false, error: message };
    }
    try {
      const axtree = await window.webContents.executeJavaScript(`
        (function() {
          var MAX_DEPTH = 15;
          var MAX_TEXT = 200;
          var MAX_NODES = 5000;
          var nodeCount = 0;
          function walk(el, depth) {
            if (depth > MAX_DEPTH || nodeCount >= MAX_NODES) return null;
            nodeCount++;
            var tag = el.tagName ? el.tagName.toLowerCase() : '#text';
            var node = { tag: tag };
            var role = el.getAttribute ? el.getAttribute('role') : null;
            if (role) node.role = role;
            var ariaLabel = el.getAttribute ? el.getAttribute('aria-label') : null;
            if (ariaLabel) node.ariaLabel = ariaLabel.substring(0, MAX_TEXT);
            if (el.id) node.id = el.id;
            var text = '';
            for (var i = 0; i < el.childNodes.length; i++) {
              if (el.childNodes[i].nodeType === 3) {
                text += el.childNodes[i].textContent;
              }
            }
            text = text.trim();
            if (text) node.text = text.substring(0, MAX_TEXT);
            var children = [];
            for (var j = 0; j < el.children.length; j++) {
              var child = walk(el.children[j], depth + 1);
              if (child) children.push(child);
            }
            if (children.length > 0) node.children = children;
            return node;
          }
          if (!document.body) return '{}';
          return JSON.stringify(walk(document.body, 0));
        })()
      `);
      return { success: true, data: axtree };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  handle(
    'debug:generate-bug-report',
    async (
      event: IpcMainInvokeEvent,
      reportData: {
        taskId?: string;
        taskPrompt?: string;
        taskStatus?: string;
        taskCreatedAt?: string;
        taskCompletedAt?: string;
        messages?: unknown[];
        debugLogs?: unknown[];
        screenshot?: string;
        axtree?: string;
        appVersion?: string;
        platform?: string;
      },
    ) => {
      try {
        assertDebugModeEnabled();
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
      let window: BrowserWindow;
      try {
        window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Untrusted window';
        return { success: false, error: message };
      }
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const defaultFilename = `bug-report-${timestamp}.json`;

        const result = await dialog.showSaveDialog(window, {
          title: 'Save Bug Report',
          defaultPath: defaultFilename,
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, reason: 'cancelled' };
        }

        let screenshotPath: string | undefined;
        if (reportData.screenshot) {
          const parsed = path.parse(result.filePath);
          const candidate = path.join(parsed.dir, `${parsed.name}.png`);
          try {
            await fs.promises.access(candidate);
            screenshotPath = path.join(parsed.dir, `${parsed.name}-${Date.now()}.png`);
          } catch {
            screenshotPath = candidate;
          }
          await fs.promises.writeFile(screenshotPath, Buffer.from(reportData.screenshot, 'base64'));
        }

        const report = {
          version: 1,
          generatedAt: new Date().toISOString(),
          app: {
            version: reportData.appVersion ?? app.getVersion(),
            platform: reportData.platform ?? process.platform,
          },
          task: {
            id: reportData.taskId,
            prompt: reportData.taskPrompt,
            status: reportData.taskStatus,
            createdAt: reportData.taskCreatedAt,
            completedAt: reportData.taskCompletedAt,
            messageCount: Array.isArray(reportData.messages) ? reportData.messages.length : 0,
          },
          messages: reportData.messages,
          debugLogs: reportData.debugLogs,
          axtree: reportData.axtree,
          screenshotFile: screenshotPath ? path.basename(screenshotPath) : null,
          hasScreenshot: Boolean(screenshotPath),
        };

        await fs.promises.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf-8');

        return { success: true, path: result.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, error: message };
      }
    },
  );
}
