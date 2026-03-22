# Permissions & Filesystem QA Suite

Tests covering the filesystem permission inline card and related access-control behaviour.

---

## Permission Inline Card — Display

| ID         | Scenario                                      | Steps                                                                                         | Expected                                                                          |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PERM-UI-01 | Permission inline card appears on file access | 1. Start a task that reads a file outside the default workspace 2. Observe the execution page | Permission inline card is displayed within the task execution view                |
| PERM-UI-02 | Permission inline card is non-blocking        | 1. Trigger a file permission request 2. Interact with another part of the UI                  | The rest of the UI remains accessible; the inline card does not block interaction |
| PERM-UI-03 | Permission inline card shows correct path     | 1. Trigger a permission request for `/tmp/secret.txt`                                         | Inline card displays the exact requested path                                     |
| PERM-UI-04 | Permission inline card dismisses on approval  | 1. Trigger a permission request 2. Click **Allow**                                            | Inline card disappears; task continues execution                                  |
| PERM-UI-05 | Permission inline card dismisses on denial    | 1. Trigger a permission request 2. Click **Deny**                                             | Inline card disappears; task receives a permission-denied error                   |

---

## Permission Inline Card — Scoping

| ID            | Scenario                                     | Steps                                                                             | Expected                                                                         |
| ------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| PERM-SCOPE-01 | Inline card scoped to requesting task        | 1. Run two tasks simultaneously 2. Only Task A triggers a file permission request | Inline card appears only on Task A's execution page; Task B's page is unaffected |
| PERM-SCOPE-02 | Inline card persists while awaiting response | 1. Trigger a permission request 2. Navigate away and return to the task page      | Inline card is still visible and awaiting a response                             |
| PERM-SCOPE-03 | Multiple simultaneous permission requests    | 1. Run three tasks, each triggering a permission request                          | Each task's execution page shows its own inline card independently               |

---

## Filesystem Access — Allowed Paths

| ID         | Scenario                             | Steps                                                                                            | Expected                                                    |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| PERM-FS-01 | Read file in allowed workspace       | 1. Configure workspace to allow `/home/user/project` 2. Run a task that reads a file there       | File is read without triggering a permission inline card    |
| PERM-FS-02 | Write file in allowed workspace      | 1. Configure workspace to allow `/home/user/project` 2. Run a task that writes a file there      | File is written without triggering a permission inline card |
| PERM-FS-03 | Read file outside allowed workspace  | 1. Configure workspace to allow `/home/user/project` 2. Run a task that reads `/etc/passwd`      | Permission inline card is shown                             |
| PERM-FS-04 | Write file outside allowed workspace | 1. Configure workspace to allow `/home/user/project` 2. Run a task that writes to `/tmp/out.txt` | Permission inline card is shown                             |

---

## Filesystem Access — Persistence

| ID              | Scenario                            | Steps                                                                              | Expected                                                                     |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PERM-PERSIST-01 | Approved path persisted for session | 1. Approve a permission request for `/tmp` 2. Run a second task accessing `/tmp`   | No inline card shown for the second task; previously approved path is reused |
| PERM-PERSIST-02 | Denied path not persisted           | 1. Deny a permission request for `/tmp` 2. Run a second task accessing `/tmp`      | Permission inline card is shown again for the second task                    |
| PERM-PERSIST-03 | Permissions reset between sessions  | 1. Approve a path 2. Restart the application 3. Run a task accessing the same path | Permission inline card is shown again after restart                          |
