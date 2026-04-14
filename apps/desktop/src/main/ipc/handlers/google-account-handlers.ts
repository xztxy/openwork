/**
 * IPC handlers for Google Workspace multi-account management.
 */
import type { IpcMainInvokeEvent } from 'electron';
import type { GoogleAccount } from '@accomplish_ai/agent-core/common';
import type { AccountManager } from '../../google-accounts/account-manager.js';
import type { TokenManager } from '../../google-accounts/token-manager.js';
import type { startGoogleOAuth } from '../../google-accounts/google-auth.js';
import { handle } from './utils.js';

type GoogleAuthFn = typeof startGoogleOAuth;

export function registerGoogleAccountHandlers(
  accountManager: AccountManager,
  tokenManager: TokenManager,
  googleAuth: GoogleAuthFn,
): void {
  handle('gws:accounts:list', async (): Promise<GoogleAccount[]> => {
    return accountManager.listAccounts();
  });

  handle(
    'gws:accounts:start-auth',
    async (
      _event: IpcMainInvokeEvent,
      label: string,
    ): Promise<{ state: string; authUrl: string }> => {
      const { state, authUrl, waitForCallback } = await googleAuth(label);

      // Kick off the background wait; the renderer completes via gws:accounts:complete-auth
      waitForCallback().catch(() => {
        /* resolved separately */
      });

      return { state, authUrl };
    },
  );

  handle(
    'gws:accounts:complete-auth',
    async (_event: IpcMainInvokeEvent, _state: string, _code: string): Promise<GoogleAccount> => {
      // The local HTTP server in google-auth resolves the callback automatically.
      // This channel triggers a full auth + account registration flow from a
      // deep-link or renderer-provided code path.
      const label = 'My Account';
      const { waitForCallback } = await googleAuth(label);
      const result = await waitForCallback();

      const now = new Date().toISOString();
      accountManager.addAccount(
        {
          googleAccountId: result.googleAccountId,
          email: result.email,
          displayName: result.displayName,
          pictureUrl: result.pictureUrl,
          label,
          connectedAt: now,
        },
        result.token,
      );

      tokenManager.scheduleRefresh(result.googleAccountId, result.token.expiresAt);

      return {
        googleAccountId: result.googleAccountId,
        email: result.email,
        displayName: result.displayName,
        pictureUrl: result.pictureUrl,
        label,
        status: 'connected',
        connectedAt: now,
        lastRefreshedAt: null,
      };
    },
  );

  handle('gws:accounts:remove', async (_event: IpcMainInvokeEvent, id: string): Promise<void> => {
    accountManager.removeAccount(id);
    tokenManager.cancelRefresh(id);
  });

  handle(
    'gws:accounts:update-label',
    async (_event: IpcMainInvokeEvent, id: string, label: string): Promise<void> => {
      accountManager.updateAccountLabel(id, label);
    },
  );
}
