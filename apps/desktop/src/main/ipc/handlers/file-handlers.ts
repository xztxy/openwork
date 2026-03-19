import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { BrowserWindow, dialog, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { FileAttachmentInfo } from '@accomplish_ai/agent-core';
import { handle, assertTrustedWindow, MAX_ATTACHMENT_FILE_SIZE } from './utils';

const TEXT_EXTS = ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'csv', 'xml', 'html', 'css'];
const CODE_EXTS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'swift',
  'kt',
  'sh',
  'bash',
  'zsh',
  'fish',
];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const PDF_EXTS = ['pdf'];

type FileType = 'image' | 'text' | 'code' | 'pdf' | 'other';

function detectFileType(ext: string): FileType {
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (PDF_EXTS.includes(ext)) return 'pdf';
  if (CODE_EXTS.includes(ext)) return 'code';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'other';
}

function buildFileAttachmentInfo(filePath: string): FileAttachmentInfo {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const type = detectFileType(ext);

  const info: FileAttachmentInfo = {
    id: crypto.randomUUID(),
    name: path.basename(filePath),
    path: filePath,
    type,
    size: stat.size,
  };

  if (type === 'text' || type === 'code') {
    try {
      info.content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Non-fatal: content stays undefined
    }
  }

  return info;
}

export function registerFileHandlers(): void {
  handle('files:pick', async (event: IpcMainInvokeEvent) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    if (result.filePaths.length > 5) {
      throw new Error('You can only select a maximum of 5 files.');
    }
    for (const filePath of result.filePaths) {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_ATTACHMENT_FILE_SIZE) {
        throw new Error(`File ${path.basename(filePath)} exceeds the 10 MB size limit.`);
      }
    }
    return result.filePaths.map(buildFileAttachmentInfo);
  });

  handle('files:process-dropped', async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
    return filePaths.map(buildFileAttachmentInfo);
  });

  handle('shell:open-external', async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const { validateHttpUrl } = await import('@accomplish_ai/agent-core');
      validateHttpUrl(url, 'External URL');
      await shell.openExternal(url);
    } catch (error) {
      console.error('Failed to open external URL:', error);
      throw error;
    }
  });
}
