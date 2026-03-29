import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccomplish } from '@/lib/accomplish';
import { createLogger } from '@/lib/logger';
import type { SandboxConfig } from '@accomplish_ai/agent-core';

const logger = createLogger('SandboxPanel');

export const DEFAULT_CONFIG: SandboxConfig = {
  mode: 'disabled',
  allowedPaths: [],
  networkRestricted: false,
  allowedHosts: [],
  networkPolicy: {
    allowOutbound: true,
  },
};

/** Regex for validating Docker image references (SaaiAravindhRaja, PR #612) */
export const DOCKER_IMAGE_REGEX = /^[\w.-]+(\/[\w.-]+)*(:[\w.-]+)?$/;

export interface UseSandboxPanelResult {
  config: SandboxConfig;
  saving: boolean;
  configError: string | null;
  saveError: string | null;
  dockerImageRef: React.RefObject<HTMLInputElement | null>;
  hostsRef: React.RefObject<HTMLTextAreaElement | null>;
  pathsRef: React.RefObject<HTMLTextAreaElement | null>;
  handleModeChange: (mode: SandboxConfig['mode']) => Promise<void>;
  handleNetworkToggle: () => Promise<void>;
  handleAllowedHostsBlur: () => void;
  handleAllowedPathsBlur: () => void;
  handleDockerImageBlur: () => void;
}

export function useSandboxPanel(): UseSandboxPanelResult {
  const [config, setConfig] = useState<SandboxConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dockerImageRef = useRef<HTMLInputElement>(null);
  const hostsRef = useRef<HTMLTextAreaElement>(null);
  const pathsRef = useRef<HTMLTextAreaElement>(null);
  const accomplish = useAccomplish();

  useEffect(() => {
    accomplish
      .getSandboxConfig()
      .then((c) => {
        if (c) {
          setConfig(c);
        }
      })
      .catch((err) => {
        logger.error('Failed to load sandbox config:', err);
      });
  }, [accomplish]);

  const saveConfig = useCallback(
    async (newConfig: SandboxConfig) => {
      setSaving(true);
      setSaveError(null);
      let merged: SandboxConfig = DEFAULT_CONFIG;
      setConfig((prev) => {
        merged = { ...prev, ...newConfig };
        return merged;
      });
      try {
        await accomplish.setSandboxConfig(merged);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save sandbox configuration';
        setSaveError(message);
        logger.error('Failed to save sandbox config:', err);
      } finally {
        setSaving(false);
      }
    },
    [accomplish],
  );

  const handleModeChange = useCallback(
    async (mode: SandboxConfig['mode']) => {
      await saveConfig({ ...config, mode });
    },
    [config, saveConfig],
  );

  const handleNetworkToggle = useCallback(async () => {
    const currentPolicy = config.networkPolicy ?? { allowOutbound: !config.networkRestricted };
    const newAllowOutbound = !currentPolicy.allowOutbound;
    await saveConfig({
      ...config,
      networkRestricted: !newAllowOutbound,
      networkPolicy: {
        ...currentPolicy,
        allowOutbound: newAllowOutbound,
      },
    });
  }, [config, saveConfig]);

  const handleAllowedHostsBlur = useCallback(() => {
    const hosts = hostsRef.current?.value ?? '';
    const hostList = hosts
      .split('\n')
      .map((h) => h.trim())
      .filter(Boolean);
    const newHosts = hostList.length > 0 ? hostList : undefined;
    const currentPolicy = config.networkPolicy ?? { allowOutbound: !config.networkRestricted };
    if (JSON.stringify(newHosts) !== JSON.stringify(currentPolicy.allowedHosts)) {
      saveConfig({
        ...config,
        allowedHosts: newHosts ?? [],
        networkPolicy: { ...currentPolicy, allowedHosts: newHosts },
      });
    }
  }, [config, saveConfig]);

  const handleAllowedPathsBlur = useCallback(() => {
    const paths = pathsRef.current?.value ?? '';
    const pathList = paths
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    if (JSON.stringify(pathList) !== JSON.stringify(config.allowedPaths)) {
      saveConfig({ ...config, allowedPaths: pathList });
    }
  }, [config, saveConfig]);

  const handleDockerImageBlur = useCallback(() => {
    const value = dockerImageRef.current?.value ?? '';
    const trimmed = value.trim() || undefined;
    if (trimmed && !DOCKER_IMAGE_REGEX.test(trimmed)) {
      setConfigError('Invalid Docker image name. Use format: name[:tag] or org/name[:tag]');
      return;
    }
    setConfigError(null);
    if (trimmed !== config.dockerImage) {
      saveConfig({ ...config, dockerImage: trimmed });
    }
  }, [config, saveConfig]);

  return {
    config,
    saving,
    configError,
    saveError,
    dockerImageRef,
    hostsRef,
    pathsRef,
    handleModeChange,
    handleNetworkToggle,
    handleAllowedHostsBlur,
    handleAllowedPathsBlur,
    handleDockerImageBlur,
  };
}
