import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderId, ConnectedProvider, OAuthCredentials } from '@accomplish_ai/agent-core';
import { DEFAULT_PROVIDERS } from '@accomplish_ai/agent-core/common';
import { getAccomplish } from '@/lib/accomplish';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useOAuthSignIn');

// Fallback models for OpenAI OAuth flow where no API key is available.
export const OPENAI_OAUTH_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: 'openai/gpt-5.2', name: 'GPT 5.2' },
  { id: 'openai/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
  { id: 'openai/gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
  { id: 'openai/gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
];

export interface UseOAuthSignInOptions {
  providerId: ProviderId;
  onConnect: (provider: ConnectedProvider) => void;
  setError: (v: string | null) => void;
}

export interface UseOAuthSignInReturn {
  signingIn: boolean;
  handleChatGptSignIn: () => Promise<void>;
}

/** Handles ChatGPT OAuth polling flow for ClassicProviderForm. */
export function useOAuthSignIn({
  providerId,
  onConnect,
  setError,
}: UseOAuthSignInOptions): UseOAuthSignInReturn {
  const { t } = useTranslation('settings');
  const [signingIn, setSigningIn] = useState(false);
  const oauthPollAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight poll on unmount.
  useEffect(() => {
    return () => {
      oauthPollAbortRef.current?.abort();
    };
  }, []);

  const handleChatGptSignIn = async () => {
    // Abort previous poll if any, then start a fresh controller.
    oauthPollAbortRef.current?.abort();
    const abortController = new AbortController();
    oauthPollAbortRef.current = abortController;

    setSigningIn(true);
    setError(null);
    let pollStarted = false;

    const providerConfig = DEFAULT_PROVIDERS.find((p) => p.id === providerId);

    try {
      const accomplish = getAccomplish();
      const result = await accomplish.loginOpenAiWithChatGpt();

      if (!result.ok) {
        setError(t('status.signInFailed'));
        return;
      }

      pollStarted = true;

      const POLL_INTERVAL_MS = 5000;
      const MAX_ATTEMPTS = 36; // 3 minutes

      const poll = async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          if (abortController.signal.aborted) {
            return;
          }

          const status = await accomplish.getOpenAiOauthStatus();

          if (abortController.signal.aborted) {
            return;
          }

          if (status.connected) {
            let availableModels = OPENAI_OAUTH_FALLBACK_MODELS;
            if (providerConfig?.modelsEndpoint) {
              const fetchResult = await accomplish.fetchProviderModels(providerId, {});
              if (fetchResult.success && fetchResult.models?.length) {
                availableModels = fetchResult.models;
              }
            }
            onConnect({
              providerId,
              connectionStatus: 'connected',
              selectedModelId: providerConfig?.defaultModelId ?? null,
              credentials: { type: 'oauth', oauthProvider: 'chatgpt' } as OAuthCredentials,
              lastConnectedAt: new Date().toISOString(),
              availableModels,
            });
            setSigningIn(false);
            return;
          }
        }
        if (!abortController.signal.aborted) {
          setError(
            t('status.signInTimedOut') ?? 'Timed out waiting for ChatGPT sign-in. Please try again.',
          );
          setSigningIn(false);
        }
      };

      void poll().catch((err) => {
        if (abortController.signal.aborted) {
          return;
        }
        logger.error('Error polling OpenAI OAuth status:', err);
        setError(err instanceof Error ? err.message : t('status.signInFailed'));
        setSigningIn(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('status.signInFailed'));
    } finally {
      if (!pollStarted) {
        setSigningIn(false);
      }
    }
  };

  return { signingIn, handleChatGptSignIn };
}
