import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ProviderId,
  ConnectedProvider,
  ApiKeyCredentials,
  OAuthCredentials,
} from '@accomplish_ai/agent-core/common';
import { DEFAULT_PROVIDERS } from '@accomplish_ai/agent-core/common';
import { getAccomplish } from '@/lib/accomplish';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ClassicProviderForm');

// Fallback models for OpenAI OAuth flow where no API key is available.
const OPENAI_OAUTH_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: 'openai/gpt-5.2', name: 'GPT 5.2' },
  { id: 'openai/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
  { id: 'openai/gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
  { id: 'openai/gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
];

interface UseClassicProviderConnectOptions {
  providerId: ProviderId;
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  isOpenAI: boolean;
  hasEditableBaseUrl: boolean;
  defaultBaseUrl: string;
}

/** Handles API key + OAuth connection logic for ClassicProviderForm. */
export function useClassicProviderConnect({
  providerId,
  connectedProvider,
  onConnect,
  isOpenAI,
  hasEditableBaseUrl,
  defaultBaseUrl,
}: UseClassicProviderConnectOptions) {
  const { t } = useTranslation('settings');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; name: string }> | null>(
    null,
  );

  const providerConfig = DEFAULT_PROVIDERS.find((p) => p.id === providerId);
  const isConnected = connectedProvider?.connectionStatus === 'connected';
  const connectedProviderBaseUrl = hasEditableBaseUrl
    ? connectedProvider?.customBaseUrl || defaultBaseUrl || undefined
    : undefined;

  useEffect(() => {
    if (!isOpenAI) {
      return;
    }
    const accomplish = getAccomplish();
    accomplish
      .getOpenAiBaseUrl()
      .then(setOpenAiBaseUrl)
      .catch((err) => logger.error('Failed to load OpenAI base URL:', err));
  }, [isOpenAI]);

  useEffect(() => {
    if (!hasEditableBaseUrl) {
      return;
    }
    setCustomBaseUrl(connectedProvider?.customBaseUrl || '');
  }, [hasEditableBaseUrl, connectedProvider?.customBaseUrl]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    const isOAuth = connectedProvider?.credentials?.type === 'oauth';
    if (!isOAuth && connectedProvider?.availableModels?.length) {
      return;
    }
    if (!providerConfig?.modelsEndpoint) {
      return;
    }
    const accomplish = getAccomplish();
    accomplish
      .fetchProviderModels(providerId, {
        baseUrl: isOpenAI ? openAiBaseUrl.trim() || undefined : connectedProviderBaseUrl,
      })
      .then((result) => {
        if (result.success && result.models?.length) {
          setFetchedModels(result.models);
        }
      })
      .catch((err) => logger.error('Failed to fetch provider models:', err));
  }, [
    connectedProvider?.availableModels?.length,
    connectedProvider?.credentials?.type,
    connectedProviderBaseUrl,
    isConnected,
    isOpenAI,
    openAiBaseUrl,
    providerConfig?.modelsEndpoint,
    providerId,
  ]);

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError(t('apiKey.enterKeyRequired'));
      return;
    }
    if (isOpenAI && openAiBaseUrl.trim()) {
      try {
        const parsed = new URL(openAiBaseUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setError(t('connectors.urlMustBeHttp'));
          return;
        }
      } catch {
        setError(t('connectors.invalidUrl'));
        return;
      }
    }
    if (hasEditableBaseUrl && customBaseUrl.trim()) {
      try {
        const parsed = new URL(customBaseUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setError(t('connectors.urlMustBeHttp'));
          return;
        }
      } catch {
        setError(t('connectors.invalidUrl'));
        return;
      }
    }
    setConnecting(true);
    setError(null);
    try {
      const accomplish = getAccomplish();
      if (isOpenAI) {
        await accomplish.setOpenAiBaseUrl(openAiBaseUrl.trim());
      }
      const explicitCustomBaseUrl = hasEditableBaseUrl ? customBaseUrl.trim() : '';
      const resolvedBaseUrl = hasEditableBaseUrl
        ? explicitCustomBaseUrl || defaultBaseUrl || undefined
        : undefined;
      const validation = await accomplish.validateApiKeyForProvider(providerId, apiKey.trim(), {
        baseUrl: resolvedBaseUrl,
      });
      if (!validation.valid) {
        setError(validation.error || t('apiKey.invalidKey'));
        setConnecting(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await accomplish.addApiKey(providerId as any, apiKey.trim());
      let models: Array<{ id: string; name: string }> | undefined;
      if (providerConfig?.modelsEndpoint) {
        const fetchResult = await accomplish.fetchProviderModels(providerId, {
          baseUrl: isOpenAI ? openAiBaseUrl.trim() || undefined : resolvedBaseUrl,
        });
        if (fetchResult.success && fetchResult.models) {
          models = fetchResult.models;
        }
      }
      const defaultModelId = providerConfig?.defaultModelId ?? null;
      const resolvedModelId = models?.some((m) => m.id === defaultModelId) ? defaultModelId : null;
      const trimmedKey = apiKey.trim();
      onConnect({
        providerId,
        connectionStatus: 'connected',
        selectedModelId: resolvedModelId,
        credentials: {
          type: 'api_key',
          keyPrefix:
            trimmedKey.length > 40
              ? trimmedKey.substring(0, 40) + '...'
              : trimmedKey.substring(0, Math.min(trimmedKey.length, 20)) + '...',
        } as ApiKeyCredentials,
        lastConnectedAt: new Date().toISOString(),
        ...(models ? { availableModels: models } : {}),
        ...(explicitCustomBaseUrl ? { customBaseUrl: explicitCustomBaseUrl } : {}),
      });
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('status.connectionFailed'));
    } finally {
      setConnecting(false);
    }
  };

  const handleChatGptSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const accomplish = getAccomplish();
      await accomplish.loginOpenAiWithChatGpt();
      const status = await accomplish.getOpenAiOauthStatus();
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('status.signInFailed'));
    } finally {
      setSigningIn(false);
    }
  };

  return {
    apiKey,
    setApiKey,
    connecting,
    error,
    openAiBaseUrl,
    setOpenAiBaseUrl,
    customBaseUrl,
    setCustomBaseUrl,
    signingIn,
    fetchedModels,
    isConnected,
    handleConnect,
    handleChatGptSignIn,
  };
}
