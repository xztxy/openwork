---
"@accomplish_ai/agent-core": patch
---

fix(agent-core): increase AskUserQuestion MCP timeout and synthesize missing todo IDs

- Increase ask-user-question MCP server timeout from 30s to 10min so users have time to respond
- Add experimental.mcp_timeout to OpenCode config for global MCP tool execution timeout
- Add 5-minute AbortSignal timeout to MCP tool's fetch() call
- Synthesize todo_id from array index when OpenCode's todowrite omits the id field
