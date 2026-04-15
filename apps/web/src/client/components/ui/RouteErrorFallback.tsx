import { useRouteError, isRouteErrorResponse, Link } from 'react-router';
import { WarningCircle } from '@phosphor-icons/react';

export function RouteErrorFallback() {
  const error = useRouteError();

  let message = 'An unexpected error occurred.';
  if (isRouteErrorResponse(error)) {
    message = `${error.status} — ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md w-full text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <WarningCircle className="h-7 w-7 text-destructive" />
          </div>
        </div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mb-6 text-sm text-muted-foreground font-mono break-all">{message}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
