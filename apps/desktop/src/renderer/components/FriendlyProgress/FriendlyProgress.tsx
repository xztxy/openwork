'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle2, 
  Loader2, 
  FileText, 
  FolderOpen, 
  Search, 
  Terminal, 
  Globe,
  MessageSquare,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProgressStep {
  id: string;
  label: string;
  description?: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  icon?: LucideIcon;
}

interface FriendlyProgressProps {
  steps: ProgressStep[];
  currentStepIndex: number;
  showDetails?: boolean;
}

// Map tool names to friendly labels and icons
export const FRIENDLY_TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  Read: { label: 'Reading your files', icon: FileText },
  Glob: { label: 'Looking through folders', icon: FolderOpen },
  Grep: { label: 'Searching for content', icon: Search },
  Bash: { label: 'Running a command', icon: Terminal },
  Write: { label: 'Creating a file', icon: FileText },
  Edit: { label: 'Making changes', icon: FileText },
  WebFetch: { label: 'Checking a website', icon: Globe },
  WebSearch: { label: 'Searching the web', icon: Globe },
  Task: { label: 'Working on a subtask', icon: MessageSquare },
  dev_browser_execute: { label: 'Using the browser', icon: Globe },
};

// Convert tool name to user-friendly label
export function getFriendlyToolLabel(toolName: string): { label: string; icon: LucideIcon } {
  return FRIENDLY_TOOL_LABELS[toolName] || { 
    label: 'Working on it...', 
    icon: Loader2 
  };
}

export function FriendlyProgress({ steps, currentStepIndex, showDetails = true }: FriendlyProgressProps) {
  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="relative mb-4">
        {/* Background track */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          {/* Filled portion */}
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ 
              width: `${((currentStepIndex + 1) / steps.length) * 100}%` 
            }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        
        {/* Step dots */}
        <div className="absolute inset-0 flex items-center justify-between px-0">
          {steps.map((step, index) => {
            const Icon = step.icon || CheckCircle2;
            return (
              <motion.div
                key={step.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  'flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors',
                  step.status === 'completed' && 'bg-primary border-primary text-primary-foreground',
                  step.status === 'active' && 'bg-background border-primary text-primary animate-pulse',
                  step.status === 'pending' && 'bg-background border-muted-foreground/30 text-muted-foreground',
                  step.status === 'error' && 'bg-destructive border-destructive text-destructive-foreground'
                )}
              >
                {step.status === 'completed' ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : step.status === 'active' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="text-xs">{index + 1}</span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Current step label */}
      <AnimatePresence mode="wait">
        {showDetails && steps[currentStepIndex] && (
          <motion.div
            key={steps[currentStepIndex].id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-center"
          >
            <p className="text-sm font-medium text-foreground">
              {steps[currentStepIndex].label}
            </p>
            {steps[currentStepIndex].description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {steps[currentStepIndex].description}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Simple inline progress for showing what the AI is currently doing
interface SimpleProgressIndicatorProps {
  toolName: string;
  details?: string;
}

export function SimpleProgressIndicator({ toolName, details }: SimpleProgressIndicatorProps) {
  const { label, icon: Icon } = getFriendlyToolLabel(toolName);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
        <Icon className={cn('h-4 w-4 text-primary', toolName === 'Bash' && 'animate-pulse')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {details && (
          <p className="text-xs text-muted-foreground truncate">{details}</p>
        )}
      </div>
      <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
    </motion.div>
  );
}
