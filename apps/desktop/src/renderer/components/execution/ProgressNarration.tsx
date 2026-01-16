import { memo } from 'react';
import { motion } from 'framer-motion';
import { springs } from '../../lib/animations';
import { cn } from '@/lib/utils';

interface ProgressNarrationProps {
  content: string;
}

/**
 * Renders agent's progress narration - the explanatory text
 * that appears before tool executions. Shown as subtle inline
 * text rather than a full message bubble.
 */
export const ProgressNarration = memo(function ProgressNarration({
  content,
}: ProgressNarrationProps) {
  // Trim and clean up the content
  const text = content?.trim();
  if (!text) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={cn(
        'px-3 py-2 text-sm text-muted-foreground',
        'border-l-2 border-muted ml-4'
      )}
    >
      {text}
    </motion.div>
  );
});
