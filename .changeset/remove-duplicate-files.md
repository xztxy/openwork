---
"@accomplish_ai/agent-core": patch
---

refactor(agent-core): remove stale duplicate files from opencode/ directory

Deleted 6 dead files left behind after the encapsulation refactor: opencode/task-manager.ts,
opencode/adapter.ts, opencode/stream-parser.ts, opencode/log-watcher.ts, opencode/index.ts
(barrel), and internal/classes/CompletionEnforcer.ts. The canonical implementations live in
internal/classes/ and are used via the factory pattern. Re-pointed test imports to the active
internal/classes/ sources. No behavior changes; public API unchanged.
