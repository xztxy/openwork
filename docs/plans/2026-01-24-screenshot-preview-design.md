# Screenshot Preview Thumbnails

Show a thumbnail preview in the chat area when the browser navigates to a new screen.

## Behavior

- **Trigger**: URL change (first screenshot always shows, then subsequent navigations)
- **Display**: 150-200px wide thumbnail inline
- **Content**: Page title only (no URL, no timestamp)
- **Interaction**: View-only, no click behavior
- **Placement**: Attached to the tool message that caused the navigation

## Data Changes

**TaskAttachment type** (`packages/shared/src/types/task.ts`):
```typescript
interface TaskAttachment {
  type: 'screenshot' | 'json';
  data: string;
  label?: string;
  showPreview?: boolean;  // true when URL changed
  pageTitle?: string;     // extracted from tool output
}
```

**Database migration** (v002):
- Add `show_preview` INTEGER column to `task_attachments`
- Add `page_title` TEXT column to `task_attachments`

## Extraction Logic

**Main process** (`handlers.ts`):
- Track `lastSeenUrl` per task in a `Map<string, string>`
- New `extractBrowserContext(text)` function extracts URL and title from tool output
- When URL differs from last seen: set `showPreview: true` on attachment
- First screenshot of a task always gets `showPreview: true`

**URL/title parsing**:
- Match `http://` or `https://` URLs in text or JSON
- Look for `"title": "..."` in JSON or `<title>` in HTML
- Fallback: show preview without title if extraction fails

## Renderer Display

**In MessageBubble** (`Execution.tsx`):
- After tool message content, check for attachments with `showPreview: true`
- Render thumbnail + title:
  ```
  ┌─────────────────────┐
  │  [thumbnail image]  │  max-width: 180px, rounded corners
  │  Page Title Here    │  12-13px, muted, ellipsis overflow
  └─────────────────────┘
  ```
- No hover effects or cursor pointer (view-only)
- `loading="lazy"` on images

## Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/src/types/task.ts` | Add `showPreview`, `pageTitle` to TaskAttachment |
| `apps/desktop/src/main/store/migrations/v002-screenshot-preview.ts` | New migration |
| `apps/desktop/src/main/store/migrations/index.ts` | Register v002, bump CURRENT_VERSION |
| `apps/desktop/src/main/store/repositories/taskHistory.ts` | Persist/retrieve new fields |
| `apps/desktop/src/main/ipc/handlers.ts` | Add extractBrowserContext(), track lastSeenUrl |
| `apps/desktop/src/renderer/pages/Execution.tsx` | Render thumbnail in MessageBubble |
