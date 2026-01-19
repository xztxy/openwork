'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, ArrowRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { QUICK_TASK_TEMPLATES, CATEGORIES, type QuickTask } from './templates';
import { QuickTaskCard } from './QuickTaskCard';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';

interface QuickTasksPanelProps {
  onSelectTask: (prompt: string) => void;
  onClose?: () => void;
}

export function QuickTasksPanel({ onSelectTask, onClose }: QuickTasksPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTask, setSelectedTask] = useState<QuickTask | null>(null);

  const filteredTasks = selectedCategory === 'all'
    ? QUICK_TASK_TEMPLATES
    : QUICK_TASK_TEMPLATES.filter(t => t.category === selectedCategory);

  const handleTaskSelect = (task: QuickTask) => {
    setSelectedTask(task);
  };

  const handleConfirmTask = () => {
    if (selectedTask) {
      onSelectTask(selectedTask.prompt);
      setSelectedTask(null);
    }
  };

  const handleBackToList = () => {
    setSelectedTask(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Quick Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Pre-made tasks for everyday computer chores
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {selectedTask ? (
          /* Task Detail View */
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={springs.gentle}
            className="flex-1 overflow-y-auto p-6"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToList}
              className="mb-4 -ml-2 text-muted-foreground hover:text-foreground"
            >
              ← Back to tasks
            </Button>

            <Card className="p-6">
              {/* Task Header */}
              <div className="flex items-start gap-4 mb-6">
                <div className={cn(
                  'flex h-14 w-14 items-center justify-center rounded-xl shrink-0',
                  'bg-primary/10 text-primary'
                )}>
                  <selectedTask.icon className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-1">
                    {selectedTask.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {selectedTask.description}
                  </p>
                </div>
              </div>

              {/* What it does */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  What this will do:
                </h4>
                <ul className="space-y-2">
                  {selectedTask.whatItDoes.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-green-500 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Safety note */}
              <div className="mb-6 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                      You're always in control
                    </h5>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      The AI will ask your permission before making any changes to your files. 
                      You can review and approve each action, or stop at any time.
                    </p>
                  </div>
                </div>
              </div>

              {/* Estimated time */}
              <div className="flex items-center justify-between py-3 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  Estimated time: <span className="font-medium text-foreground">{selectedTask.estimatedTime}</span>
                </span>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  selectedTask.difficulty === 'easy' 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                )}>
                  {selectedTask.difficulty === 'easy' ? '✨ Easy' : '📋 Medium'}
                </span>
              </div>
            </Card>

            {/* Start button */}
            <div className="mt-6">
              <Button 
                onClick={handleConfirmTask} 
                className="w-full h-12 text-base font-medium"
                size="lg"
              >
                Start This Task
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </motion.div>
        ) : (
          /* Task List View */
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={springs.gentle}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Category Tabs */}
            <div className="px-6 py-3 border-b border-border overflow-x-auto">
              <div className="flex gap-2">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                      selectedCategory === category.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Task Grid */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTasks.map((task) => (
                  <QuickTaskCard
                    key={task.id}
                    task={task}
                    onSelect={handleTaskSelect}
                  />
                ))}
              </div>

              {filteredTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No tasks in this category yet</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
