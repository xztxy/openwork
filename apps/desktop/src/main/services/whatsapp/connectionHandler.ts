/**
 * connectionHandler — Baileys connection.update event handler factory.
 *
 * Extracted from WhatsAppService for modularity.
 */
import type { MessagingConnectionStatus } from '@accomplish_ai/agent-core/common';
import { cleanupAuthState } from './authCleanup.js';
import { scheduleReconnect, type ReconnectState } from './reconnection.js';

export interface ConnectionHandlerDeps {
  reconnect: ReconnectState;
  authStatePath: string;
  disposed: boolean;
  manualDisconnect: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSocket(): any | null;
  setStatus(status: MessagingConnectionStatus): void;
  setQrCode(qr: string | null): void;
  reconnectAttemptReset(): void;
  connectFn(): Promise<void>;
  emitQr(qr: string): void;
  emitPhoneNumber(phone: string): void;
  emitOwnerLid(lid: string): void;
}

export function makeConnectionUpdateHandler(
  deps: ConnectionHandlerDeps,
  DisconnectReason: Record<string, number>,
  jidNormalizedUser: (jid: string) => string,
) {
  return (update: {
    connection?: string;
    lastDisconnect?: { error?: unknown };
    qr?: string;
  }): void => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      deps.setQrCode(qr);
      deps.setStatus('qr_ready');
      deps.emitQr(qr);
    }

    if (connection === 'close') {
      deps.setQrCode(null);

      if (deps.manualDisconnect) {
        deps.setStatus('disconnected');
        return;
      }

      const boomError = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const statusCode = boomError?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        deps.setStatus('logged_out');
        cleanupAuthState(deps.authStatePath);
      } else if (statusCode === DisconnectReason.restartRequired) {
        if (!deps.disposed) {
          deps
            .connectFn()
            .catch((err) => console.error('[WhatsApp] Restart reconnect failed:', err));
        }
      } else if (statusCode === DisconnectReason.connectionReplaced) {
        console.warn('[WhatsApp] Connection replaced by another session');
        deps.setStatus('disconnected');
      } else if (statusCode === DisconnectReason.forbidden) {
        console.error('[WhatsApp] Account forbidden (banned or restricted)');
        deps.setStatus('logged_out');
        cleanupAuthState(deps.authStatePath);
      } else if (statusCode === DisconnectReason.badSession) {
        console.error('[WhatsApp] Bad session — cleaning up auth state');
        cleanupAuthState(deps.authStatePath);
        if (!deps.disposed) {
          deps
            .connectFn()
            .catch((err) => console.error('[WhatsApp] Reconnect after bad session:', err));
        }
      } else if (!deps.disposed) {
        scheduleReconnect(deps.reconnect, deps.connectFn, () => deps.setStatus('disconnected'));
      }
    }

    if (connection === 'open') {
      deps.setQrCode(null);
      deps.reconnectAttemptReset();
      deps.setStatus('connected');

      const user = deps.getSocket()?.user;
      if (user?.id) {
        const phoneNumber = user.id.split(':')[0].split('@')[0];
        deps.emitPhoneNumber(phoneNumber);
      }
      if (user?.lid) {
        deps.emitOwnerLid(jidNormalizedUser(user.lid));
      }
    }
  };
}
