# Safe File Deletion Skill Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the OpenCode agent always requests explicit user permission before deleting files, with a prominent visual warning in the UI.

**Approach:** Create an OpenCode skill that instructs the agent to use `request_file_permission` before any deletion, and enhance the UI to show a more alarming visual treatment for delete operations.

---

## Task 1: Create the Skill File

**File:** `apps/desktop/skills/safe-file-deletion/SKILL.md`

```markdown
---
name: safe-file-deletion
description: Enforces explicit user permission before any file deletion. Activates when you're about to use rm, unlink, fs.rm, or any operation that removes files from disk. MUST be followed for all delete operations.
---

# Safe File Deletion

## Rule

Before deleting ANY file, you MUST:

1. Call `request_file_permission` with `operation: "delete"`
2. For multiple files, use `filePaths` array (not multiple calls)
3. Wait for response
4. Only proceed if "allowed"
5. If "denied", acknowledge and do NOT delete

## Applies To

- `rm` commands (single or multiple files)
- `rm -rf` (directories)
- `unlink`, `fs.rm`, `fs.rmdir`
- Any script or tool that deletes files

## Examples

Single file:
```json
{
  "operation": "delete",
  "filePath": "/path/to/file.txt"
}
```

Multiple files (batched into one prompt):
```json
{
  "operation": "delete",
  "filePaths": ["/path/to/file1.txt", "/path/to/file2.txt"]
}
```

## No Workarounds

Never bypass deletion warnings by:
- Emptying files instead of deleting
- Moving to hidden/temp locations
- Using obscure commands

The user will see a prominent warning. Wait for explicit approval.
```

**Commit:** `feat: add safe-file-deletion skill`

---

## Task 2: Add Multi-File Support to MCP Server

**File:** `apps/desktop/skills/file-permission/src/index.ts`

**Step 1:** Update `FilePermissionInput` interface (around line 21):

```typescript
interface FilePermissionInput {
  operation: 'create' | 'delete' | 'rename' | 'move' | 'modify' | 'overwrite';
  filePath?: string;      // Single file (backwards compat)
  filePaths?: string[];   // Multiple files
  targetPath?: string;
  contentPreview?: string;
}
```

**Step 2:** Update input schema in `ListToolsRequestSchema` handler to add `filePaths`:

After the `filePath` property (around line 49), add:

```typescript
filePaths: {
  type: 'array',
  items: { type: 'string' },
  description: 'Array of absolute paths for batch operations (e.g., deleting multiple files)',
},
```

**Step 3:** Update the tool call handler to pass `filePaths` to the API (around line 92):

```typescript
body: JSON.stringify({
  operation,
  filePath,
  filePaths,  // Add this
  targetPath,
  contentPreview: contentPreview?.substring(0, 500),
}),
```

**Commit:** `feat(file-permission): add filePaths array for batch operations`

---

## Task 3: Update Permission API to Handle filePaths

**File:** `apps/desktop/src/main/permission-api.ts`

**Step 1:** Update request body parsing to include `filePaths`:

Where the request body is parsed, add `filePaths` to the destructured properties:

```typescript
const { operation, filePath, filePaths, targetPath, contentPreview } = data;
```

**Step 2:** Include `filePaths` in the permission request sent to renderer:

```typescript
const permissionRequest: PermissionRequest = {
  id: requestId,
  taskId,
  type: 'file',
  operation,
  filePath,
  filePaths,  // Add this
  targetPath,
  contentPreview,
  createdAt: new Date().toISOString(),
};
```

**Commit:** `feat(permission-api): support filePaths in permission requests`

---

## Task 4: Update Shared Types

**File:** Find where `PermissionRequest` type is defined (likely `packages/shared/src/types/` or in the permission-api file)

Add `filePaths` to the type:

```typescript
interface PermissionRequest {
  // ... existing fields
  filePath?: string;
  filePaths?: string[];  // Add this
  // ...
}
```

**Commit:** `feat(types): add filePaths to PermissionRequest`

---

## Task 5: Enhance UI for Delete Operations

**File:** `apps/desktop/src/renderer/pages/Execution.tsx`

**Step 1:** Create a helper to check if operation is delete:

```typescript
function isDeleteOperation(request: PermissionRequest): boolean {
  return request.type === 'file' && request.operation === 'delete';
}
```

**Step 2:** Update the file permission modal section to show enhanced delete UI.

When `isDeleteOperation(permissionRequest)` is true, render:

```tsx
{/* Delete operation warning banner */}
{isDeleteOperation(permissionRequest) && (
  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
    <div className="flex items-center gap-2 text-red-600 font-semibold mb-2">
      <AlertTriangle className="h-5 w-5" />
      <span>FILE DELETION</span>
    </div>
    <p className="text-sm text-red-600/90">
      {permissionRequest.filePaths && permissionRequest.filePaths.length > 1
        ? `${permissionRequest.filePaths.length} files will be permanently deleted:`
        : 'This file will be permanently deleted:'}
    </p>
  </div>
)}

{/* File path(s) display */}
<div className={cn(
  "mb-4 p-3 rounded-lg font-mono text-sm break-all",
  isDeleteOperation(permissionRequest)
    ? "bg-red-500/5 border border-red-500/20 text-red-600"
    : "bg-muted text-foreground"
)}>
  {permissionRequest.filePaths && permissionRequest.filePaths.length > 0 ? (
    <ul className="space-y-1">
      {permissionRequest.filePaths.map((path, idx) => (
        <li key={idx}>• {path}</li>
      ))}
    </ul>
  ) : (
    <p>{permissionRequest.filePath}</p>
  )}
</div>

{/* Warning text for deletes */}
{isDeleteOperation(permissionRequest) && (
  <p className="text-sm text-red-600/80 mb-4">
    This action cannot be undone.
  </p>
)}
```

**Step 3:** Update the Allow button for delete operations:

```tsx
<Button
  onClick={() => handlePermissionResponse(true)}
  className={cn(
    "flex-1",
    isDeleteOperation(permissionRequest) && "bg-red-600 hover:bg-red-700"
  )}
  data-testid="permission-allow-button"
>
  {isDeleteOperation(permissionRequest)
    ? (permissionRequest.filePaths?.length ?? 0) > 1
      ? 'Delete All'
      : 'Delete'
    : 'Allow'}
</Button>
```

**Step 4:** Import `AlertTriangle` icon (if using lucide-react or similar).

**Commit:** `feat(ui): add prominent delete warning in permission modal`

---

## Task 6: Manual Testing

1. Start the desktop app: `pnpm dev`
2. Enter a task that triggers file deletion (e.g., "Delete the file at /tmp/test.txt")
3. Verify:
   - The skill is loaded (agent mentions using `request_file_permission`)
   - Modal shows red warning banner with "FILE DELETION" header
   - File path is in red-tinted box
   - "This action cannot be undone" warning appears
   - Button says "Delete" (red) instead of "Allow"
4. Test multi-file deletion:
   - Trigger deletion of multiple files
   - Verify all files are listed in a single modal
   - Button says "Delete All"

---

## Summary

This design adds a two-layer protection for file deletions:

1. **Skill layer:** Instructs the agent to ALWAYS call `request_file_permission` before any delete, and to batch multiple files into one request
2. **UI layer:** Shows a prominent red warning with clear messaging that the action is irreversible

Sources:
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills/)
