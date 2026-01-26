export { ProgressEvaluator } from './progress-evaluator';
export { ConversationBuffer } from './conversation-buffer';
export {
  EVALUATOR_SYSTEM_PROMPT,
  buildEvaluationPrompt,
  formatTodoState,
} from './prompts';
export type { EvaluationResult } from './prompts';

import type { TodoItem } from '@accomplish/shared';
import type { EvaluationResult } from './prompts';

export interface EvaluationContext {
  originalRequest: string;
  conversationLog: string;
  todoState: TodoItem[] | null;
  previousEvaluations: EvaluationResult[];
}
