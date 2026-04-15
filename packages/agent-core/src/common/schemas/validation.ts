import { z } from 'zod';

export const fileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.enum(['image', 'text', 'code', 'pdf', 'other']),
  size: z.number(),
  content: z.string().optional(),
});

export const taskConfigSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  taskId: z.string().optional(),
  workingDirectory: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  systemPromptAppend: z.string().optional(),
  outputSchema: z.record(z.any()).optional(),
  sessionId: z.string().optional(),
  chrome: z.boolean().optional(),
  workspaceId: z.string().optional(),
  attachments: z.array(fileAttachmentSchema).optional(),
  modelId: z.string().optional(),
  provider: z.string().optional(),
  /**
   * Originating surface. Consumed by the daemon's no-UI auto-deny policy.
   * Defaults to 'ui' when omitted.
   */
  source: z.enum(['ui', 'whatsapp', 'scheduler']).optional(),
});

export const permissionResponseSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  decision: z.enum(['allow', 'deny']),
  message: z.string().optional(),
  selectedOptions: z.array(z.string()).optional(),
  customText: z.string().optional(),
});

// OpenAI ChatGPT OAuth RPC payload schemas. Added in Phase 4a of the
// OpenCode SDK cutover port so the daemon can own the SDK-based flow.
//
// Desktop IPC handler two-call protocol:
//   startLogin()                           → { sessionId, authorizeUrl }
//   shell.openExternal(authorizeUrl)       (Electron-only)
//   awaitCompletion({ sessionId, timeoutMs })
//                                          → { ok: true, plan } | { ok: false, error }

export const authOpenAiAwaitCompletionSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  timeoutMs: z.number().int().positive().optional(),
});

export const resumeSessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  existingTaskId: z.string().optional(),
  chrome: z.boolean().optional(),
  workspaceId: z.string().optional(),
  attachments: z.array(fileAttachmentSchema).optional(),
});

export function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const message = result.error.issues.map((issue: z.ZodIssue) => issue.message).join('; ');
    throw new Error(`Invalid payload: ${message}`);
  }
  return result.data;
}
