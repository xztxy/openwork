import type { TaskMessage } from '../types/task.js';

/**
 * Merge an incoming `TaskMessage` into an existing one by `id`.
 *
 * Browser-safe (pure object operations — no Node imports) so the renderer's
 * `taskStore.upsertTaskMessages` path can share the same semantics as the
 * daemon-side `MessageBatcher`. Phase 1c of the SDK cutover port (commercial
 * PR #720) added stable-ID coalescing — the renderer must collapse a
 * `{ id: 'x', toolStatus: 'running' }` followed by a `{ id: 'x',
 * toolStatus: 'completed' }` into ONE row, not append two. Without merge,
 * every tool-state transition produces a duplicate bubble in the UI.
 *
 * Merge rules:
 * - `timestamp`: preserve the existing one. The UI sorts by timestamp;
 *   letting each update float to "now" would re-order the list.
 * - Tool fields (`toolInput`, `toolName`, `toolStatus`): take incoming if
 *   present, otherwise keep existing. Incoming usually carries the newest
 *   known state (e.g. `'completed'` superseding `'running'`).
 * - Model metadata (`modelId`, `providerId`): take incoming if present;
 *   the adapter stamps these from `ModelContext`.
 * - Attachments: take incoming if present (the SDK emits the full list on
 *   each update).
 * - Everything else: spread-override from incoming.
 */
export function mergeTaskMessage(existing: TaskMessage, incoming: TaskMessage): TaskMessage {
  return {
    ...existing,
    ...incoming,
    timestamp: existing.timestamp,
    attachments: incoming.attachments ?? existing.attachments,
    toolInput: incoming.toolInput ?? existing.toolInput,
    toolName: incoming.toolName ?? existing.toolName,
    toolStatus: incoming.toolStatus ?? existing.toolStatus,
    modelId: incoming.modelId ?? existing.modelId,
    providerId: incoming.providerId ?? existing.providerId,
  };
}

/**
 * Upsert `incoming` messages into an `existing` array by stable `id`.
 * Messages with new IDs append; messages with matching IDs merge via
 * `mergeTaskMessage`. Preserves the original ordering.
 *
 * Used by the renderer's task-update-actions on both the single-message
 * path (`addTaskUpdate` with event.type === 'message') and the batch path
 * (`addTaskUpdateBatch`). Before Phase 1c both paths did raw append, which
 * produced duplicate tool rows on every `running → completed` transition.
 */
export function upsertTaskMessages(
  existing: TaskMessage[],
  incoming: TaskMessage[],
): TaskMessage[] {
  if (incoming.length === 0) return existing;

  // Build an index over existing ids for O(n+m) merge. The index uses the
  // array index so we can rewrite in place rather than re-sorting.
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) {
    const id = existing[i]?.id;
    if (id) idToIndex.set(id, i);
  }

  const result = [...existing];
  for (const incomingMsg of incoming) {
    const existingIdx = incomingMsg.id ? idToIndex.get(incomingMsg.id) : undefined;
    if (existingIdx !== undefined) {
      result[existingIdx] = mergeTaskMessage(result[existingIdx], incomingMsg);
    } else {
      if (incomingMsg.id) idToIndex.set(incomingMsg.id, result.length);
      result.push(incomingMsg);
    }
  }
  return result;
}
