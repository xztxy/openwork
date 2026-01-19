'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertCircle, FileText, Folder, Clock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TaskSummaryProps {
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  // Summary of what was done
  summary?: string;
  // List of actions taken
  actions?: Array<{
    type: 'created' | 'modified' | 'deleted' | 'moved' | 'read' | 'searched';
    description: string;
  }>;
  // Duration
  duration?: string;
  // Callback for starting a new task
  onNewTask?: () => void;
  // Callback for retrying
  onRetry?: () => void;
}

const actionIcons = {
  created: FileText,
  modified: FileText,
  deleted: FileText,
  moved: Folder,
  read: FileText,
  searched: FileText,
};

const actionLabels = {
  created: 'Created',
  modified: 'Updated',
  deleted: 'Removed',
  moved: 'Moved',
  read: 'Reviewed',
  searched: 'Found',
};

export function TaskSummary({ 
  status, 
  summary, 
  actions = [], 
  duration,
  onNewTask,
  onRetry 
}: TaskSummaryProps) {
  const isSuccess = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg mx-auto"
    >
      <Card className="overflow-hidden">
        {/* Header */}
        <div className={cn(
          'px-6 py-5 text-center',
          isSuccess && 'bg-green-50 dark:bg-green-950/30',
          isFailed && 'bg-red-50 dark:bg-red-950/30',
          status === 'cancelled' && 'bg-gray-50 dark:bg-gray-950/30',
          status === 'interrupted' && 'bg-amber-50 dark:bg-amber-950/30'
        )}>
          <div className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full mx-auto mb-3',
            isSuccess && 'bg-green-100 dark:bg-green-900/50',
            isFailed && 'bg-red-100 dark:bg-red-900/50',
            status === 'cancelled' && 'bg-gray-100 dark:bg-gray-900/50',
            status === 'interrupted' && 'bg-amber-100 dark:bg-amber-900/50'
          )}>
            {isSuccess && <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />}
            {isFailed && <XCircle className="h-7 w-7 text-red-600 dark:text-red-400" />}
            {status === 'cancelled' && <XCircle className="h-7 w-7 text-gray-600 dark:text-gray-400" />}
            {status === 'interrupted' && <AlertCircle className="h-7 w-7 text-amber-600 dark:text-amber-400" />}
          </div>
          
          <h3 className={cn(
            'text-lg font-semibold mb-1',
            isSuccess && 'text-green-800 dark:text-green-200',
            isFailed && 'text-red-800 dark:text-red-200',
            status === 'cancelled' && 'text-gray-800 dark:text-gray-200',
            status === 'interrupted' && 'text-amber-800 dark:text-amber-200'
          )}>
            {isSuccess && '✓ Task Completed!'}
            {isFailed && 'Task Failed'}
            {status === 'cancelled' && 'Task Cancelled'}
            {status === 'interrupted' && 'Task Stopped'}
          </h3>
          
          {duration && (
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Took {duration}
            </p>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <div className="px-6 py-4 border-b border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">What happened:</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {summary}
            </p>
          </div>
        )}

        {/* Actions taken */}
        {actions.length > 0 && (
          <div className="px-6 py-4 border-b border-border">
            <h4 className="text-sm font-medium text-foreground mb-3">Actions taken:</h4>
            <ul className="space-y-2">
              {actions.slice(0, 5).map((action, index) => {
                const Icon = actionIcons[action.type] || FileText;
                return (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {actionLabels[action.type]}:
                      </span>{' '}
                      {action.description}
                    </span>
                  </li>
                );
              })}
              {actions.length > 5 && (
                <li className="text-xs text-muted-foreground italic">
                  ...and {actions.length - 5} more actions
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-4 flex gap-3">
          {isFailed && onRetry && (
            <Button variant="outline" onClick={onRetry} className="flex-1">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          )}
          {onNewTask && (
            <Button onClick={onNewTask} className="flex-1">
              {isSuccess ? 'Start Another Task' : 'New Task'}
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

// Helper to generate a friendly summary from task messages
export function generateFriendlySummary(messages: Array<{ content?: string; type: string }>): string {
  // Find the last assistant message that looks like a summary
  const assistantMessages = messages
    .filter(m => m.type === 'assistant' && m.content)
    .map(m => m.content as string);

  if (assistantMessages.length === 0) {
    return 'The task was processed.';
  }

  // Return the last assistant message, truncated if needed
  const lastMessage = assistantMessages[assistantMessages.length - 1];
  if (lastMessage.length > 200) {
    return lastMessage.slice(0, 197) + '...';
  }
  return lastMessage;
}
