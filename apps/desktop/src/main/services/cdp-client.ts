/**
 * CdpClient — lightweight WebSocket-based Chrome DevTools Protocol client.
 * Contributed by Dev0907 (PR #480) for ENG-695.
 */

const COMMAND_TIMEOUT_MS = 10_000;

interface CdpCommandResponse {
  id: number;
  result?: unknown;
  error?: { message?: string };
}

export interface CdpEvent {
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private listeners = new Set<(event: CdpEvent) => void>();

  async connect(endpoint: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const ws = new WebSocket(endpoint);

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`Failed to connect to CDP endpoint: ${endpoint}`));
      };
      const cleanup = () => {
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('error', handleError);
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('error', handleError);
    });

    ws.addEventListener('message', (event) => {
      void this.handleMessage(event.data);
    });
    ws.addEventListener('close', () => {
      this.rejectAllPending(new Error('CDP websocket closed'));
    });
    ws.addEventListener('error', () => {
      this.rejectAllPending(new Error('CDP websocket error'));
    });

    this.ws = ws;
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('CDP websocket is not connected');
    }

    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws?.send(JSON.stringify(payload));
    });
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error('CDP disconnected'));
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.ws.close();
    }
    this.ws = null;
  }

  private async handleMessage(rawData: unknown): Promise<void> {
    const raw = await this.toText(rawData);
    if (!raw) return;

    let message: CdpCommandResponse & CdpEvent;
    try {
      message = JSON.parse(raw) as CdpCommandResponse & CdpEvent;
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(message.id);

      if (message.error?.message) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async toText(rawData: unknown): Promise<string | null> {
    if (typeof rawData === 'string') return rawData;
    if (rawData instanceof ArrayBuffer) return Buffer.from(rawData).toString('utf8');
    if (ArrayBuffer.isView(rawData)) {
      return Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf8');
    }
    if (typeof Blob !== 'undefined' && rawData instanceof Blob) return rawData.text();
    return null;
  }
}
