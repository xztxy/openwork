export function isClosedPageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Target page, context or browser has been closed/i.test(message) ||
    /\bTarget closed\b/i.test(message) ||
    /\bPage closed\b/i.test(message) ||
    /\bSession closed\b/i.test(message) ||
    /Page\.createIsolatedWorld/i.test(message) ||
    /\bNo target with given id\b/i.test(message) ||
    /\bBrowser window not found\b/i.test(message)
  );
}

export function isTransientNavigationContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Execution context was destroyed/i.test(message) ||
    /Cannot read properties of null/i.test(message)
  );
}

export function isTimeoutError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).startsWith('Timeout: ');
}

export async function fetchWithRetry(
  url: string,
  maxRetries = 5,
  delayMs = 500,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms),
    ),
  ]);
}

export function respondInternalError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  error: unknown,
): void {
  console.error('[dev-browser] internal error', error);
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}
