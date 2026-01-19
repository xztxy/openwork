'use client';

import { motion } from 'framer-motion';
import { Clock, ChevronRight } from 'lucide-react';
import type { QuickTask } from './templates';
import { cn } from '@/lib/utils';

interface QuickTaskCardProps {
  task: QuickTask;
  onSelect: (task: QuickTask) => void;
  compact?: boolean;
}

const colorClasses: Record<string, { bg: string; border: string; icon: string; badge: string }> = {
  blue: {
    bg: 'hover:bg-blue-50/50 dark:hover:bg-blue-950/20',
    border: 'hover:border-blue-200 dark:hover:border-blue-800',
    icon: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  },
  green: {
    bg: 'hover:bg-green-50/50 dark:hover:bg-green-950/20',
    border: 'hover:border-green-200 dark:hover:border-green-800',
    icon: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  },
  purple: {
    bg: 'hover:bg-purple-50/50 dark:hover:bg-purple-950/20',
    border: 'hover:border-purple-200 dark:hover:border-purple-800',
    icon: 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  },
  orange: {
    bg: 'hover:bg-orange-50/50 dark:hover:bg-orange-950/20',
    border: 'hover:border-orange-200 dark:hover:border-orange-800',
    icon: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  },
  teal: {
    bg: 'hover:bg-teal-50/50 dark:hover:bg-teal-950/20',
    border: 'hover:border-teal-200 dark:hover:border-teal-800',
    icon: 'bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-400',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  },
};

export function QuickTaskCard({ task, onSelect, compact = false }: QuickTaskCardProps) {
  const Icon = task.icon;
  const colors = colorClasses[task.color] || colorClasses.blue;

  if (compact) {
    return (
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onSelect(task)}
        className={cn(
          'flex items-center gap-3 p-3 rounded-xl border border-border bg-card text-left transition-all duration-200',
          colors.bg,
          colors.border
        )}
      >
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg shrink-0', colors.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm text-foreground truncate">{task.title}</h4>
          <p className="text-xs text-muted-foreground truncate">{task.description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </motion.button>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(task)}
      className={cn(
        'flex flex-col p-4 rounded-xl border border-border bg-card text-left transition-all duration-200 h-full',
        colors.bg,
        colors.border
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', colors.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', colors.badge)}>
          {task.difficulty === 'easy' ? '✨ Easy' : '📋 Medium'}
        </span>
      </div>

      {/* Content */}
      <h4 className="font-semibold text-foreground mb-1">{task.title}</h4>
      <p className="text-sm text-muted-foreground mb-3 flex-1">{task.description}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{task.estimatedTime}</span>
        </div>
        <div className="flex items-center gap-1 text-xs font-medium text-primary">
          <span>Start</span>
          <ChevronRight className="h-3 w-3" />
        </div>
      </div>
    </motion.button>
  );
}
