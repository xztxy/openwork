#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { loadManifest, resolveAccounts } from './accounts.js';
import {
  parseFlags,
  handleApiError,
  cmdList,
  cmdGet,
  cmdCreate,
  cmdUpdate,
  cmdDelete,
  cmdRsvp,
  cmdFreeTime,
} from './calendar.js';

const server = new Server(
  { name: 'google-calendar', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'google_calendar',
      description:
        'Manage Google Calendar events across connected accounts. Supports listing, creating, updating, deleting events, responding to invitations, and finding free time slots.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'Subcommand and flags. Examples: "list --start 2024-01-01T00:00:00Z --end 2024-01-07T00:00:00Z", "get <eventId>", "create --title Meeting --start 2024-01-02T10:00:00Z --end 2024-01-02T11:00:00Z", "update --eventId <id> --title NewTitle", "delete <eventId>", "rsvp --eventId <id> --status accepted", "free-time --start 2024-01-01T00:00:00Z --end 2024-01-07T00:00:00Z --duration 30"',
          },
          account: {
            type: 'string',
            description: 'Account label or email to use. Omit to query all accounts (read ops).',
          },
        },
        required: ['command'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  if (request.params.name !== 'google_calendar') {
    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const { command, account: accountParam } = request.params.arguments as {
    command: string;
    account?: string;
  };

  const accounts = loadManifest();
  if (accounts.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No Google accounts connected. Add accounts in Settings → Integrations.',
        },
      ],
      isError: true,
    };
  }

  const parts = command.trim().split(/\s+/);
  const subcommand = parts[0];
  const rest = parts.slice(1);
  const flags = parseFlags(rest);

  // free-time always uses all accounts — skip normal resolution
  if (subcommand === 'free-time') {
    try {
      const result = await cmdFreeTime(accounts, flags);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${handleApiError(error, 'unknown')}` }],
        isError: true,
      };
    }
  }

  const { resolved, clarificationNeeded, error } = resolveAccounts(
    accounts,
    accountParam,
    subcommand,
  );

  if (error) {
    return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
  }
  if (clarificationNeeded) {
    return { content: [{ type: 'text', text: clarificationNeeded }] };
  }

  try {
    let result: unknown;

    if (subcommand === 'list') {
      if (resolved.length === 1) {
        result = await cmdList(resolved[0], flags);
      } else {
        const allResults = await Promise.allSettled(resolved.map((acc) => cmdList(acc, flags)));
        const merged: unknown[] = [];
        for (const r of allResults) {
          if (r.status === 'fulfilled') {
            merged.push(...r.value);
          }
        }
        const sorted = (merged as Array<{ start?: string | null }>).sort((a, b) => {
          return (a.start ?? '').localeCompare(b.start ?? '');
        });
        result = sorted;
      }
    } else if (subcommand === 'get') {
      const eventId = rest[0];
      result = await cmdGet(resolved[0], eventId);
    } else if (subcommand === 'create') {
      result = await cmdCreate(resolved[0], flags);
    } else if (subcommand === 'update') {
      result = await cmdUpdate(resolved[0], flags);
    } else if (subcommand === 'delete') {
      const eventId = rest[0];
      result = await cmdDelete(resolved[0], eventId);
    } else if (subcommand === 'rsvp') {
      result = await cmdRsvp(resolved[0], flags);
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown subcommand: ${subcommand}. Available: list, get, create, update, delete, rsvp, free-time`,
          },
        ],
        isError: true,
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const email = resolved[0]?.email ?? 'unknown';
    return {
      content: [{ type: 'text', text: `Error: ${handleApiError(error, email)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Calendar MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
