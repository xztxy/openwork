/**
 * whatsappStorageSync — storage mutation helpers for WhatsApp events
 *
 * Extracted from wireTaskBridge to keep individual files under 200 lines.
 * Handles persistence of phoneNumber, connectionStatus, and lastConnectedAt
 * in response to WhatsApp service events.
 */
import type { WhatsAppService } from './WhatsAppService';
import type { TaskBridge } from './taskBridge';
import { getStorage } from '../../store/storage';

/**
 * Registers listeners on `service` that persist WhatsApp state into storage
 * and wire ownerLid into the task bridge.
 */
export function wireStatusListeners(
  service: WhatsAppService,
  storage: ReturnType<typeof getStorage>,
  bridge: TaskBridge,
): void {
  service.on('phoneNumber', (phoneNumber: string) => {
    const config = storage.getMessagingConfig();
    storage.setMessagingConfig({
      integrations: {
        ...(config?.integrations ?? {}),
        whatsapp: {
          ...(config?.integrations?.whatsapp ?? {
            platform: 'whatsapp',
            enabled: true,
            tunnelEnabled: false,
          }),
          phoneNumber,
          lastConnectedAt: Date.now(),
        },
      },
    });
  });

  service.on('ownerLid', (lid: string) => {
    bridge.setOwnerLid(lid);
  });

  // When status changes to connected, persist the state
  service.on('status', (status: string) => {
    if (status === 'connected') {
      const config = storage.getMessagingConfig();
      storage.setMessagingConfig({
        integrations: {
          ...(config?.integrations ?? {}),
          whatsapp: {
            ...(config?.integrations?.whatsapp ?? {
              platform: 'whatsapp',
              enabled: true,
              tunnelEnabled: false,
            }),
            connectionStatus: 'connected',
            lastConnectedAt: Date.now(),
          },
        },
      });
    }
  });
}
