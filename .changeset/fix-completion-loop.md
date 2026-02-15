---
'@accomplish_ai/agent-core': patch
---

fix(agent-core): prevent infinite completion loop on incomplete todos

Integrate incomplete-todos feedback into getPartialContinuationPrompt so the
agent knows exactly which items are unresolved and to call todowrite. Reduce
default maxContinuationAttempts from 50 to 10 as a safety net. Add
continuationPrompt to debug logging for observability.
