import { Component, type ReactNode, type ErrorInfo } from 'react';
import { WarningCircle, ArrowCounterClockwise } from '@phosphor-icons/react';

interface Props {
  children: ReactNode;
  /** Custom fallback. Receives `reset` callback to retry. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log for debugging — uses console.error intentionally (boundary context, not production logic)
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

interface FallbackProps {
  error: Error;
  reset: () => void;
  /** Make it compact for inline use (e.g. inside a conversation) */
  compact?: boolean;
}

export function DefaultFallback({ error, reset, compact = false }: FallbackProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <WarningCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">
          Something went wrong rendering this content.{' '}
          <span className="opacity-60 font-mono text-xs">{error.message}</span>
        </span>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 flex items-center gap-1 text-xs text-destructive/80 hover:text-destructive transition-colors"
        >
          <ArrowCounterClockwise className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <WarningCircle className="h-7 w-7 text-destructive" />
          </div>
        </div>
        <h2 className="mb-1 text-base font-semibold text-foreground">Something went wrong</h2>
        <p className="mb-4 text-sm text-muted-foreground font-mono break-all">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ArrowCounterClockwise className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
