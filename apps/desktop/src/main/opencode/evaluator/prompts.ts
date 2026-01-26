import type { TodoItem } from '@accomplish/shared';

export interface EvaluationResult {
  done: boolean;
  summary: string;
  remaining: string[];
  continuation_prompt: string;
  is_stuck: boolean;
}

/**
 * System prompt for the evaluator agent.
 * Registered in OpenCode config as agent "evaluator".
 * Instructs the LLM to return ONLY valid JSON.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are a task completion evaluator. Your ONLY job is to determine if an AI agent has completed its assigned task.

You will receive:
1. The original user request
2. The agent's conversation log (what the agent said and did)
3. The agent's todo list (if any)
4. Previous evaluation results (if this is a retry)

You MUST return ONLY a valid JSON object with this exact schema:
{
  "done": boolean,
  "summary": string,
  "remaining": string[],
  "continuation_prompt": string,
  "is_stuck": boolean
}

RULES:
- Return ONLY the JSON object. No explanation, no markdown, no extra text.
- "done" should be true ONLY if every part of the original request has been addressed.
- "remaining" should list specific, actionable items — not vague descriptions.
- "continuation_prompt" should be a clear, direct instruction that tells the agent exactly what to do next. Include context about what's already been done so the agent doesn't repeat work. If done=true, set this to empty string.
- "is_stuck" should be true if: (a) previous evaluations show the same remaining items, or (b) the agent has made no meaningful progress, or (c) the agent hit an unresolvable blocker.
- If there are incomplete todos, the task is NOT done regardless of what the agent said.`;

/**
 * Build the evaluation prompt with all context.
 */
export function buildEvaluationPrompt(
  originalRequest: string,
  conversationLog: string,
  todoState: TodoItem[] | null,
  previousEvaluations: EvaluationResult[]
): string {
  const parts: string[] = [];

  parts.push(`## ORIGINAL REQUEST\n${originalRequest}`);
  parts.push(`## AGENT CONVERSATION LOG\n${conversationLog}`);
  parts.push(`## TODO STATE\n${formatTodoState(todoState)}`);

  if (previousEvaluations.length > 0) {
    const evalSummary = previousEvaluations
      .map((e, i) => {
        const remainingStr = e.remaining.length > 0
          ? `Remaining: ${e.remaining.join(', ')}`
          : 'No remaining items';
        return `Evaluation ${i + 1}: done=${e.done}, stuck=${e.is_stuck}, ${remainingStr}`;
      })
      .join('\n');
    parts.push(`## PREVIOUS EVALUATIONS\n${evalSummary}`);
  }

  parts.push(`## INSTRUCTIONS\nEvaluate whether the agent has completed the original request. Return ONLY valid JSON.`);

  return parts.join('\n\n');
}

/**
 * Format todo items for inclusion in the evaluation prompt.
 */
export function formatTodoState(todos: TodoItem[] | null): string {
  if (!todos || todos.length === 0) {
    return 'No todos created by agent.';
  }

  const statusIcon: Record<string, string> = {
    completed: '[x]',
    in_progress: '[~]',
    pending: '[ ]',
    cancelled: '[-]',
  };

  return todos
    .map((t) => `${statusIcon[t.status] || '[ ]'} ${t.content}`)
    .join('\n');
}
