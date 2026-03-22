/**
 * WhatsAppService — Baileys-based WhatsApp channel adapter
 *
 * Contributed by aryan877 (PR #595 feat/whatsapp-integration).
 * Handles connection lifecycle, QR-code authentication, message reception,
 * exponential-backoff reconnection, and auth-state cleanup.
 */
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type {
  MessagingConnectionStatus,
  MessagingProviderId,
  ChannelAdapter,
} from '@accomplish_ai/agent-core/common';

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 2000;

export interface InboundChannelMessage {
  channelType: MessagingProviderId;
  channelId: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: number;
}

export interface OutboundProgressEvent {
  channelType: MessagingProviderId;
  channelId: string;
  phase: 'starting' | 'in-progress' | 'completed' | 'failed';
  text: string;
  percentage?: number;
}

export interface WhatsAppServiceEvents {
  qr: (qrString: string) => void;
  status: (status: MessagingConnectionStatus) => void;
  message: (msg: {
    messageId: string;
    senderId: string;
    senderName?: string;
    text: string;
    timestamp: number;
    isGroup: boolean;
    isFromMe: boolean;
  }) => void;
  phoneNumber: (phoneNumber: string) => void;
  ownerLid: (lid: string) => void;
}

export class WhatsAppService extends EventEmitter implements ChannelAdapter {
  readonly channelType: MessagingProviderId = 'whatsapp';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any | null = null;
  private status: MessagingConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authStatePath: string;
  private disposed = false;
  private qrCode: string | null = null;

  constructor() {
    super();
    this.authStatePath = path.join(app.getPath('userData'), 'whatsapp-auth');
  }

  getStatus(): MessagingConnectionStatus {
    return this.status;
  }

  private setStatus(status: MessagingConnectionStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error('WhatsApp service has been disposed');
    }

    if (this.status === 'connecting') {
      return;
    }

    this.setStatus('connecting');
    this.reconnectAttempts = 0;

    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default;
      const {
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        jidNormalizedUser,
      } = baileys;
      const pino = (await import('pino')).default;

      let version: [number, number, number] | undefined;
      try {
        version = (await fetchLatestBaileysVersion()).version;
      } catch (err) {
        console.warn('[WhatsApp] Failed to fetch latest Baileys version, using default:', err);
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authStatePath);
      const logger = pino({ level: 'silent' });

      // Clean up old socket before creating a new one — prevents listener leaks on reconnect
      if (this.socket) {
        this.socket.ev.removeAllListeners('creds.update');
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.ev.removeAllListeners('messages.upsert');
        this.socket.end(new Error('Reconnecting'));
        this.socket = null;
      }

      this.socket = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: ['Accomplish', 'Desktop', '1.0.0'],
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on(
        'connection.update',
        (update: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            this.qrCode = qr;
            this.setStatus('qr_ready');
            this.emit('qr', qr);
          }

          if (connection === 'close') {
            this.qrCode = null;
            const boomError = lastDisconnect?.error as
              | { output?: { statusCode?: number } }
              | undefined;
            const statusCode = boomError?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
              this.setStatus('logged_out');
              this.cleanupAuthState();
            } else if (statusCode === DisconnectReason.restartRequired) {
              if (!this.disposed) {
                this.connect().catch((err) =>
                  console.error('[WhatsApp] Restart reconnect failed:', err),
                );
              }
            } else if (statusCode === DisconnectReason.connectionReplaced) {
              console.warn('[WhatsApp] Connection replaced by another session');
              this.setStatus('disconnected');
            } else if (statusCode === DisconnectReason.forbidden) {
              console.error('[WhatsApp] Account forbidden (banned or restricted)');
              this.setStatus('logged_out');
              this.cleanupAuthState();
            } else if (statusCode === DisconnectReason.badSession) {
              console.error('[WhatsApp] Bad session — cleaning up auth state');
              this.cleanupAuthState();
              if (!this.disposed) {
                this.connect().catch((err) =>
                  console.error('[WhatsApp] Reconnect after bad session:', err),
                );
              }
            } else if (!this.disposed) {
              this.attemptReconnect();
            }
          }

          if (connection === 'open') {
            this.qrCode = null;
            this.reconnectAttempts = 0;
            this.setStatus('connected');

            const user = this.socket?.user;
            if (user?.id) {
              const phoneNumber = user.id.split(':')[0].split('@')[0];
              this.emit('phoneNumber', phoneNumber);
            }
            if (user?.lid) {
              this.emit('ownerLid', jidNormalizedUser(user.lid));
            }
          }
        },
      );

      this.socket.ev.on('messages.upsert', (upsert: { type: string; messages: unknown[] }) => {
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages as Array<Record<string, unknown>>) {
          if (!msg.message) continue;

          const message = msg.message as Record<string, unknown>;
          const extendedText = message.extendedTextMessage as Record<string, unknown> | undefined;
          const imageMsg = message.imageMessage as Record<string, unknown> | undefined;
          const videoMsg = message.videoMessage as Record<string, unknown> | undefined;
          const docMsg = message.documentMessage as Record<string, unknown> | undefined;

          const text =
            (message.conversation as string) ||
            (extendedText?.text as string) ||
            (imageMsg?.caption as string) ||
            (videoMsg?.caption as string) ||
            (docMsg?.caption as string) ||
            (docMsg?.title as string) ||
            '';

          if (!text.trim()) continue;

          const key = msg.key as Record<string, unknown>;
          const senderId = (key.remoteJid as string) || '';
          const isGroup = senderId.endsWith('@g.us');
          const senderName = (msg.pushName as string) || undefined;
          const isFromMe = key.fromMe === true;

          const rawTs = msg.messageTimestamp;
          let ts: number;
          if (typeof rawTs === 'number') {
            ts = rawTs;
          } else if (
            rawTs != null &&
            typeof rawTs === 'object' &&
            'toNumber' in (rawTs as object)
          ) {
            ts = (rawTs as { toNumber(): number }).toNumber();
          } else {
            ts = 0;
          }

          this.emit('message', {
            messageId: (key.id as string) || '',
            senderId,
            senderName,
            text,
            timestamp: ts * 1000,
            isGroup,
            isFromMe,
          });
        }
      });
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  async sendMessage(recipientId: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp is not connected');
    }
    await this.socket.sendMessage(recipientId, { text });
  }

  getQrCode(): string | null {
    return this.qrCode;
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    if (this.socket) {
      await this.socket.logout().catch(() => {});
      this.socket.end(new Error('User requested disconnect'));
      this.socket = null;
    }
    this.cleanupAuthState();
    this.setStatus('disconnected');
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.end(new Error('Service disposed'));
      this.socket = null;
    }
    this.removeAllListeners();
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[WhatsApp] Max reconnect attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    // Cast to satisfy strict MessagingConnectionStatus union — "reconnecting" is an internal transient
    (this as EventEmitter).emit('status', 'connecting');
    this.status = 'connecting';

    const delay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `[WhatsApp] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => console.error('[WhatsApp] Reconnect failed:', err));
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupAuthState(): void {
    try {
      if (fs.existsSync(this.authStatePath)) {
        fs.rmSync(this.authStatePath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[WhatsApp] Failed to cleanup auth state:', err);
    }
  }
}
