import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import type { ConnectedProvider, NimCredentials } from '@accomplish_ai/agent-core/common';
import {
  ModelSelector,
  ConnectButton,
  ConnectedControls,
  ProviderFormHeader,
  FormError,
} from '../shared';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import { getAccomplish } from '@/lib/accomplish';

// Import NIM logo
import nimLogo from '/assets/ai-logos/nim.svg';

const NIM_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

interface NimProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function NimProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: NimProviderFormProps) {
  const { t } = useTranslation('settings');
  const [serverUrl, setServerUrl] = useState(NIM_DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const accomplish = getAccomplish();
      const trimmedKey = apiKey.trim();

      if (!trimmedKey) {
        setError(t('nim.apiKeyRequired', 'NVIDIA API key is required'));
        setConnecting(false);
        return;
      }

      const trimmedUrl = serverUrl.trim() || NIM_DEFAULT_BASE_URL;

      // Test connection and fetch models
      const result = await accomplish.testNimConnection(trimmedUrl, trimmedKey);
      if (!result.success) {
        setError(result.error || t('status.connectionFailed'));
        setConnecting(false);
        return;
      }

      // Save API key
      await accomplish.addApiKey('nim', trimmedKey);

      // Map models to the expected format, preserving all metadata including toolSupport
      const models = result.models?.map((m) => ({ ...m })) || [];

      const provider: ConnectedProvider = {
        providerId: 'nim',
        connectionStatus: 'connected',
        selectedModelId: null,
        credentials: {
          type: 'nim',
          serverUrl: trimmedUrl,
          keyPrefix: trimmedKey.substring(0, 10) + '...',
        } as NimCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: models,
      };

      onConnect(provider);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('status.connectionFailed'));
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || [];

  return (
    <div
      className="rounded-xl border border-border bg-card p-5"
      data-testid="provider-settings-panel"
    >
      <ProviderFormHeader logoSrc={nimLogo} providerName="NVIDIA NIM" />

      <div className="space-y-3">
        <AnimatePresence mode="wait">
          {!isConnected ? (
            <motion.div
              key="disconnected"
              variants={settingsVariants.fadeSlide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={settingsTransitions.enter}
              className="space-y-3"
            >
              <div>
                <label htmlFor="nim-server-url" className="mb-2 block text-sm font-medium text-foreground">
                  {t('nim.serverUrl', 'Endpoint URL')}
                </label>
                <input
                  id="nim-server-url"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder={NIM_DEFAULT_BASE_URL}
                  data-testid="nim-server-url"
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                />
              </div>

              <div>
                <label htmlFor="nim-api-key" className="mb-2 block text-sm font-medium text-foreground">
                  {t('apiKey.title')}
                  <span className="text-destructive ml-0.5">*</span>
                </label>
                <input
                  id="nim-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('nim.apiKeyPlaceholder', 'nvapi-...')}
                  data-testid="nim-api-key"
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'nim.apiKeyHint',
                    'Get your API key from NGC: org.ngc.nvidia.com/setup/api-key',
                  )}
                </p>
              </div>

              <FormError error={error} />
              <ConnectButton onClick={handleConnect} connecting={connecting} />
            </motion.div>
          ) : (
            <motion.div
              key="connected"
              variants={settingsVariants.fadeSlide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={settingsTransitions.enter}
              className="space-y-3"
            >
              {/* Display saved connection details */}
              <div className="space-y-3">
                <div>
                  <label htmlFor="nim-server-url-connected" className="mb-2 block text-sm font-medium text-foreground">
                    {t('nim.serverUrl', 'Endpoint URL')}
                  </label>
                  <input
                    id="nim-server-url-connected"
                    type="text"
                    value={
                      (connectedProvider?.credentials as NimCredentials)?.serverUrl ||
                      NIM_DEFAULT_BASE_URL
                    }
                    disabled
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                  />
                </div>
                <div>
                  <label htmlFor="nim-api-key-connected" className="mb-2 block text-sm font-medium text-foreground">
                    {t('apiKey.title')}
                  </label>
                  <input
                    id="nim-api-key-connected"
                    type="text"
                    value={
                      (connectedProvider?.credentials as NimCredentials)?.keyPrefix ||
                      t('apiKey.saved')
                    }
                    disabled
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                  />
                </div>
              </div>

              <ConnectedControls onDisconnect={onDisconnect} />

              {/* Model Selector */}
              <ModelSelector
                models={models}
                value={connectedProvider?.selectedModelId || null}
                onChange={onModelChange}
                error={showModelError && !connectedProvider?.selectedModelId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
