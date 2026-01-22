#!/usr/bin/env node
/**
 * context-memory MCP Server
 *
 * PURPOSE: Persists session context across CLI restarts to enable
 * reliable continuations without cache loss.
 *
 * TOOLS:
 * - update_session_context: Agent calls to save current context
 * - get_session_context: Adapter calls to retrieve context for continuation
 * - clear_session_context: Clean up after task completion
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { saveContext, loadContext, deleteContext } from './storage.js';
import type { SessionContext, UpdateContextInput } from './types.js';

console.error('[context-memory] Starting MCP server...');

// Get task ID from environment (set by adapter)
const TASK_ID = process.env.ACCOMPLISH_TASK_ID || 'default';
const SESSION_ID = process.env.ACCOMPLISH_SESSION_ID || `session_${Date.now()}`;

const server = new Server(
  { name: 'context-memory', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

/**
 * Format context as a continuation prompt
 */
function formatContextAsPrompt(context: SessionContext): string {
  const sections: string[] = [];

  sections.push('## Session Context (Continuation)');
  sections.push('');
  sections.push('### Original Request');
  sections.push(context.originalRequest);
  sections.push('');

  sections.push('### Work Completed');
  sections.push(context.summary);
  sections.push('');

  if (context.keyDecisions.length > 0) {
    sections.push('### Key Decisions');
    for (const decision of context.keyDecisions) {
      sections.push(`- ${decision}`);
    }
    sections.push('');
  }

  if (context.filesModified.length > 0) {
    sections.push('### Files Touched');
    for (const file of context.filesModified) {
      sections.push(`- ${file.path} (${file.operation})`);
    }
    sections.push('');
  }

  sections.push('### Current Status');
  sections.push(context.currentStatus);
  sections.push('');

  if (context.remainingWork) {
    sections.push('### Remaining Work');
    sections.push(context.remainingWork);
    sections.push('');
  }

  if (context.blockers.length > 0) {
    sections.push('### Blockers');
    for (const blocker of context.blockers) {
      sections.push(`- ${blocker}`);
    }
    sections.push('');
  }

  sections.push('---');
  sections.push('');
  sections.push('**IMPORTANT**: Continue from where you left off. All context you need is above.');
  sections.push('When done, call complete_task with the final status.');
  sections.push('Remember to call update_session_context periodically to save your progress.');

  return sections.join('\n');
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'update_session_context',
      description:
        'Save your current session context. Call this periodically during long tasks and always before calling complete_task(partial). This ensures context is preserved if the session needs to restart.',
      inputSchema: {
        type: 'object',
        required: ['original_request', 'summary', 'current_status'],
        properties: {
          original_request: {
            type: 'string',
            description: 'The original user request (what they asked for)',
          },
          summary: {
            type: 'string',
            description: 'Summary of work completed so far',
          },
          current_status: {
            type: 'string',
            description: 'What you are currently working on',
          },
          key_decisions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key decisions made and why',
          },
          files_modified: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of file paths that were modified',
          },
          remaining_work: {
            type: 'string',
            description: 'What still needs to be done',
          },
          blockers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Any blockers or issues encountered',
          },
        },
      },
    },
    {
      name: 'get_session_context',
      description:
        'Retrieve saved session context. Used by the system to restore context when continuing a session.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Task ID to get context for (defaults to current task)',
          },
          format: {
            type: 'string',
            enum: ['raw', 'prompt'],
            description: 'Output format: raw JSON or formatted prompt',
          },
        },
      },
    },
    {
      name: 'clear_session_context',
      description:
        'Clear saved session context. Called automatically when a task completes successfully.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Task ID to clear context for (defaults to current task)',
          },
        },
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  // Tool: update_session_context
  if (toolName === 'update_session_context') {
    const input = request.params.arguments as UpdateContextInput;

    // Load existing context or create new one
    let context = loadContext(TASK_ID);
    const now = new Date().toISOString();

    if (!context) {
      context = {
        sessionId: SESSION_ID,
        taskId: TASK_ID,
        updatedAt: now,
        originalRequest: input.original_request,
        summary: input.summary,
        keyDecisions: input.key_decisions || [],
        filesModified: [],
        currentStatus: input.current_status,
        remainingWork: input.remaining_work,
        recentToolCalls: [],
        blockers: input.blockers || [],
      };
    } else {
      // Update existing context
      context.updatedAt = now;
      context.summary = input.summary;
      context.currentStatus = input.current_status;
      if (input.key_decisions) {
        // Append new decisions, avoid duplicates
        const newDecisions = input.key_decisions.filter(
          (d) => !context!.keyDecisions.includes(d)
        );
        context.keyDecisions.push(...newDecisions);
      }
      if (input.remaining_work !== undefined) {
        context.remainingWork = input.remaining_work;
      }
      if (input.blockers) {
        context.blockers = input.blockers;
      }
    }

    // Update files modified
    if (input.files_modified) {
      for (const filePath of input.files_modified) {
        const existing = context.filesModified.find((f) => f.path === filePath);
        if (!existing) {
          context.filesModified.push({
            path: filePath,
            operation: 'modified',
            timestamp: now,
          });
        }
      }
    }

    saveContext(context);

    return {
      content: [
        {
          type: 'text',
          text: `Context saved successfully. Last updated: ${context.updatedAt}`,
        },
      ],
    };
  }

  // Tool: get_session_context
  if (toolName === 'get_session_context') {
    const args = request.params.arguments as {
      task_id?: string;
      format?: 'raw' | 'prompt';
    };

    const taskId = args.task_id || TASK_ID;
    const format = args.format || 'prompt';
    const context = loadContext(taskId);

    if (!context) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ has_context: false }),
          },
        ],
      };
    }

    if (format === 'raw') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ has_context: true, context }),
          },
        ],
      };
    }

    // Format as prompt
    const formattedPrompt = formatContextAsPrompt(context);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            has_context: true,
            formatted_prompt: formattedPrompt,
          }),
        },
      ],
    };
  }

  // Tool: clear_session_context
  if (toolName === 'clear_session_context') {
    const args = request.params.arguments as { task_id?: string };
    const taskId = args.task_id || TASK_ID;
    const deleted = deleteContext(taskId);

    return {
      content: [
        {
          type: 'text',
          text: deleted
            ? `Context cleared for task ${taskId}`
            : `No context found for task ${taskId}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[context-memory] MCP server running');
}

main().catch((error) => {
  console.error('[context-memory] Fatal error:', error);
  process.exit(1);
});
