import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getAccomplish } from '@/lib/accomplish';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import type { ConnectedProvider, VertexProviderCredentials } from '@accomplish_ai/agent-core/common';
import {
  ModelSelector,
  ConnectButton,
  ConnectedControls,
  ProviderFormHeader,
  FormError,
} from '../../shared';
import { VertexServiceAccountTab } from './VertexServiceAccountTab';
import { VertexAdcTab } from './VertexAdcTab';

import vertexLogo from '/assets/ai-logos/vertex.svg';

interface VertexProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function VertexProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: VertexProviderFormProps) {
  const [authTab, setAuthTab] = useState<'serviceAccount' | 'adc'>('serviceAccount');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('global');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const accomplish = getAccomplish();

      const credentials = authTab === 'serviceAccount'
        ? {
            authType: 'serviceAccount' as const,
            serviceAccountJson,
            projectId: projectId.trim(),
            location,
          }
        : {
            authType: 'adc' as const,
            projectId: projectId.trim(),
            location,
          };

      const validation = await accomplish.validateVertexCredentials(credentials);

      if (!validation.valid) {
        setError(validation.error || 'Invalid credentials');
        setConnecting(false);
        return;
      }

      // Save credentials
      await accomplish.saveVertexCredentials(credentials);

      // Fetch available models
      const credentialsJson = JSON.stringify(credentials);
      const modelsResult = await accomplish.fetchVertexModels(credentialsJson);
      const fetchedModels = modelsResult.success ? modelsResult.models : [];
      setAvailableModels(fetchedModels);

      // Try to find a reasonable default model
      const preferredDefault = 'vertex/google/gemini-2.5-pro';
      const hasPreferred = fetchedModels.some(m => m.id === preferredDefault);

      const provider: ConnectedProvider = {
        providerId: 'vertex',
        connectionStatus: 'connected',
        selectedModelId: hasPreferred ? preferredDefault : null,
        credentials: {
          type: 'vertex',
          authMethod: authTab,
          projectId: projectId.trim(),
          location,
          ...(authTab === 'serviceAccount'
            ? (() => {
                try {
                  const parsed = JSON.parse(serviceAccountJson);
                  return { serviceAccountEmail: parsed.client_email };
                } catch {
                  return {};
                }
              })()
            : {}
          ),
        } as VertexProviderCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: fetchedModels,
      };

      onConnect(provider);
      setServiceAccountJson('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || availableModels;

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={vertexLogo} providerName="Vertex AI" />

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
              {/* Auth tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setAuthTab('serviceAccount')}
                  data-testid="vertex-auth-tab-sa"
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    authTab === 'serviceAccount'
                      ? 'bg-[#4A7C59] text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Service Account
                </button>
                <button
                  onClick={() => setAuthTab('adc')}
                  data-testid="vertex-auth-tab-adc"
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    authTab === 'adc'
                      ? 'bg-[#4A7C59] text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  ADC
                </button>
              </div>

              {authTab === 'serviceAccount' ? (
                <VertexServiceAccountTab
                  serviceAccountJson={serviceAccountJson}
                  projectId={projectId}
                  location={location}
                  onJsonChange={setServiceAccountJson}
                  onProjectIdChange={setProjectId}
                  onLocationChange={setLocation}
                />
              ) : (
                <VertexAdcTab
                  projectId={projectId}
                  location={location}
                  onProjectIdChange={setProjectId}
                  onLocationChange={setLocation}
                />
              )}

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
              {/* Display saved credentials info */}
              <div className="space-y-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Auth Method</label>
                  <input
                    type="text"
                    value={
                      (connectedProvider?.credentials as VertexProviderCredentials)?.authMethod === 'serviceAccount'
                        ? 'Service Account'
                        : 'Application Default Credentials'
                    }
                    disabled
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                  />
                </div>
                {(connectedProvider?.credentials as VertexProviderCredentials)?.serviceAccountEmail && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Service Account</label>
                    <input
                      type="text"
                      value={(connectedProvider?.credentials as VertexProviderCredentials)?.serviceAccountEmail || ''}
                      disabled
                      className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Project</label>
                  <input
                    type="text"
                    value={(connectedProvider?.credentials as VertexProviderCredentials)?.projectId || ''}
                    disabled
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Location</label>
                  <input
                    type="text"
                    value={(connectedProvider?.credentials as VertexProviderCredentials)?.location || ''}
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
