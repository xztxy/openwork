'use client';

import { motion } from 'framer-motion';
import { 
  Shield, 
  FileText, 
  Folder, 
  Terminal, 
  Globe, 
  Trash2, 
  FilePlus,
  FileEdit,
  FolderInput,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';

interface FriendlyPermissionDialogProps {
  type: 'file' | 'command' | 'browser' | 'other';
  operation?: string;
  filePath?: string;
  targetPath?: string;
  toolName?: string;
  toolInput?: unknown;
  question?: string;
  contentPreview?: string;
  onAllow: () => void;
  onDeny: () => void;
}

// Map operations to friendly descriptions
function getFriendlyDescription(operation: string, filePath: string, targetPath?: string): {
  title: string;
  description: string;
  icon: LucideIcon;
  riskLevel: 'safe' | 'caution' | 'warning';
  details: string[];
} {
  const fileName = filePath.split('/').pop() || filePath;
  const folderPath = filePath.split('/').slice(0, -1).join('/') || '/';

  switch (operation?.toLowerCase()) {
    case 'create':
      return {
        title: 'Create a new file',
        description: `The AI wants to create a new file called "${fileName}"`,
        icon: FilePlus,
        riskLevel: 'safe',
        details: [
          `File: ${fileName}`,
          `Location: ${folderPath}`,
          'This will add a new file - nothing existing will be changed'
        ]
      };
    
    case 'modify':
    case 'edit':
    case 'overwrite':
      return {
        title: 'Edit an existing file',
        description: `The AI wants to make changes to "${fileName}"`,
        icon: FileEdit,
        riskLevel: operation === 'overwrite' ? 'warning' : 'caution',
        details: [
          `File: ${fileName}`,
          `Location: ${folderPath}`,
          operation === 'overwrite' 
            ? '⚠️ This will replace the entire file content'
            : 'Changes will be made to parts of this file'
        ]
      };
    
    case 'delete':
      return {
        title: 'Delete a file',
        description: `The AI wants to delete "${fileName}"`,
        icon: Trash2,
        riskLevel: 'warning',
        details: [
          `File: ${fileName}`,
          `Location: ${folderPath}`,
          '⚠️ This file will be moved to Trash'
        ]
      };
    
    case 'move':
    case 'rename':
      return {
        title: operation === 'rename' ? 'Rename a file' : 'Move a file',
        description: `The AI wants to ${operation} "${fileName}"`,
        icon: FolderInput,
        riskLevel: 'caution',
        details: [
          `From: ${filePath}`,
          `To: ${targetPath || 'new location'}`,
          'The original file will be moved, not copied'
        ]
      };
    
    default:
      return {
        title: 'File operation',
        description: `The AI wants to access "${fileName}"`,
        icon: FileText,
        riskLevel: 'caution',
        details: [
          `File: ${fileName}`,
          `Operation: ${operation || 'access'}`,
        ]
      };
  }
}

// Get friendly description for command/tool operations
function getToolDescription(toolName: string, toolInput: unknown): {
  title: string;
  description: string;
  icon: LucideIcon;
  riskLevel: 'safe' | 'caution' | 'warning';
  details: string[];
} {
  const input = toolInput as Record<string, unknown>;
  
  switch (toolName?.toLowerCase()) {
    case 'bash':
      const command = (input?.command as string) || '';
      const isDestructive = /rm|delete|remove|drop/i.test(command);
      return {
        title: 'Run a command',
        description: 'The AI wants to run a terminal command',
        icon: Terminal,
        riskLevel: isDestructive ? 'warning' : 'caution',
        details: [
          `Command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`,
          isDestructive 
            ? '⚠️ This command may delete or modify data'
            : 'This will execute in your terminal'
        ]
      };
    
    case 'webfetch':
    case 'websearch':
      return {
        title: 'Access the web',
        description: 'The AI wants to visit a website or search online',
        icon: Globe,
        riskLevel: 'safe',
        details: [
          `URL or search: ${String(input?.url || input?.query || 'web')}`,
          'This only reads information - no changes to your files'
        ]
      };
    
    default:
      return {
        title: `Use ${toolName}`,
        description: `The AI wants to use the ${toolName} tool`,
        icon: Shield,
        riskLevel: 'caution',
        details: [
          `Tool: ${toolName}`,
          'Review the details below before allowing'
        ]
      };
  }
}

export function FriendlyPermissionDialog({
  type,
  operation,
  filePath,
  targetPath,
  toolName,
  toolInput,
  question,
  contentPreview,
  onAllow,
  onDeny,
}: FriendlyPermissionDialogProps) {
  // Get friendly info based on type
  const info = type === 'file' && operation && filePath
    ? getFriendlyDescription(operation, filePath, targetPath)
    : toolName
      ? getToolDescription(toolName, toolInput)
      : {
          title: question || 'Permission Required',
          description: 'The AI is asking for your permission',
          icon: Shield,
          riskLevel: 'caution' as const,
          details: []
        };

  const Icon = info.icon;

  const riskColors = {
    safe: {
      bg: 'bg-green-50 dark:bg-green-950/30',
      border: 'border-green-200 dark:border-green-800',
      icon: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400',
      badge: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
    },
    caution: {
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-200 dark:border-amber-800',
      icon: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    },
    warning: {
      bg: 'bg-red-50 dark:bg-red-950/30',
      border: 'border-red-200 dark:border-red-800',
      icon: 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400',
      badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
    },
  };

  const colors = riskColors[info.riskLevel];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={springs.bouncy}
        className="w-full max-w-md"
      >
        <Card className={cn('overflow-hidden', colors.border)}>
          {/* Header */}
          <div className={cn('px-6 py-5', colors.bg)}>
            <div className="flex items-start gap-4">
              <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl shrink-0', colors.icon)}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-foreground">
                    {info.title}
                  </h3>
                  {info.riskLevel === 'warning' && (
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1', colors.badge)}>
                      <AlertTriangle className="h-3 w-3" />
                      Caution
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {info.description}
                </p>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="px-6 py-4 border-b border-border">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Details
            </h4>
            <ul className="space-y-2">
              {info.details.map((detail, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-foreground break-all">{detail}</span>
                </li>
              ))}
            </ul>

            {/* Content preview for file operations */}
            {contentPreview && (
              <details className="mt-4">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  📄 Preview content changes
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-muted text-xs overflow-x-auto max-h-32 overflow-y-auto font-mono">
                  {contentPreview}
                </pre>
              </details>
            )}
          </div>

          {/* Safety tip */}
          <div className="px-6 py-3 bg-muted/50">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              <span>
                {info.riskLevel === 'safe' 
                  ? 'This action is safe and reversible'
                  : info.riskLevel === 'warning'
                    ? 'Review carefully - this action may not be easily undone'
                    : 'The AI needs your approval to proceed'
                }
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 flex gap-3">
            <Button
              variant="outline"
              onClick={onDeny}
              className="flex-1"
            >
              No, Don't Allow
            </Button>
            <Button
              onClick={onAllow}
              className={cn(
                'flex-1',
                info.riskLevel === 'warning' && 'bg-amber-600 hover:bg-amber-700'
              )}
            >
              Yes, Allow
            </Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
