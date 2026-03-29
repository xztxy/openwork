import type { PermissionRequest } from '@accomplish_ai/agent-core/common';
import { cn } from '@/lib/utils';
import {
  getDisplayFilePaths,
  getOperationBadgeClasses,
  isDeleteOperation,
} from './permission-utils';

interface PermissionDialogFileProps {
  permissionRequest: PermissionRequest;
}

export function PermissionDialogFile({ permissionRequest }: PermissionDialogFileProps) {
  const paths = getDisplayFilePaths(permissionRequest);
  const isDelete = isDeleteOperation(permissionRequest);

  return (
    <>
      {isDelete && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-600">
            {paths.length > 1
              ? `${paths.length} files will be permanently deleted:`
              : 'This file will be permanently deleted:'}
          </p>
        </div>
      )}

      {!isDelete && (
        <div className="mb-3">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
              getOperationBadgeClasses(permissionRequest.fileOperation),
            )}
          >
            {permissionRequest.fileOperation?.toUpperCase()}
          </span>
        </div>
      )}

      <div
        className={cn(
          'mb-4 p-3 rounded-lg',
          isDelete ? 'bg-red-500/5 border border-red-500/20' : 'bg-muted',
        )}
      >
        {paths.length > 1 ? (
          <ul className="space-y-1">
            {paths.map((path, idx) => (
              <li
                key={idx}
                className={cn(
                  'text-sm font-mono break-all',
                  isDelete ? 'text-red-600' : 'text-foreground',
                )}
              >
                • {path}
              </li>
            ))}
          </ul>
        ) : (
          <p
            className={cn(
              'text-sm font-mono break-all',
              isDelete ? 'text-red-600' : 'text-foreground',
            )}
          >
            {paths[0]}
          </p>
        )}
        {permissionRequest.targetPath && (
          <p className="text-sm font-mono text-muted-foreground mt-1">
            → {permissionRequest.targetPath}
          </p>
        )}
      </div>

      {isDelete && <p className="text-sm text-red-600/80 mb-4">This action cannot be undone.</p>}

      {permissionRequest.contentPreview && (
        <details className="mb-4">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Preview content
          </summary>
          <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto max-h-32 overflow-y-auto">
            {permissionRequest.contentPreview}
          </pre>
        </details>
      )}
    </>
  );
}
