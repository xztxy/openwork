import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { FileAttachmentInfo } from '@accomplish_ai/agent-core/common';
import { MAX_FILES, processFileAttachments } from '@/lib/fileUtils';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish } from '@/lib/accomplish';
import { createLogger } from '@/lib/logger';
import { hasAnyReadyProvider } from '@accomplish_ai/agent-core/common';
import { USE_CASE_KEYS, FAVORITES_PREVIEW_COUNT } from './homeConstants';

export { FAVORITES_PREVIEW_COUNT } from './homeConstants';

type SettingsTab = 'providers' | 'voice' | 'skills' | 'connectors';

const logger = createLogger('Home');

export function useHomePage() {
  const [prompt, setPrompt] = useState('');
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachmentInfo[]>([]);
  const [workingDirectory, setWorkingDirectory] = useState<string | undefined>(undefined);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('providers');

  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation('home');

  const favorites = useTaskStore((state) => state.favorites);
  const favoritesList = Array.isArray(favorites) ? favorites : [];
  const loadFavorites = useTaskStore((state) => state.loadFavorites);
  const removeFavorite = useTaskStore((state) => state.removeFavorite);
  const { startTask, interruptTask, isLoading, addTaskUpdate, setPermissionRequest } =
    useTaskStore();

  const accomplish = useMemo(() => getAccomplish(), []);

  const useCaseExamples = useMemo(
    () =>
      USE_CASE_KEYS.map(({ key, icons }) => ({
        key,
        title: t(`useCases.${key}.title`),
        description: t(`useCases.${key}.description`),
        prompt: t(`useCases.${key}.prompt`),
        icons,
      })),
    [t],
  );

  useEffect(() => {
    if (location.pathname === '/' && typeof loadFavorites === 'function') {
      void loadFavorites();
    }
  }, [location.pathname, loadFavorites]);

  useEffect(() => {
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });
    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });
    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, setPermissionRequest, accomplish]);

  const buildPromptWithAttachments = useCallback(
    (basePrompt: string, files: FileAttachmentInfo[]): string => {
      if (files.length === 0) {
        return basePrompt;
      }
      const fileRefs = files.map((file) => {
        if (file.type === 'image') {
          return `[Attached image: ${file.path}]`;
        }
        return `[Attached file: ${file.path}]`;
      });
      return `${basePrompt}\n\nAttached files:\n${fileRefs.join('\n')}`;
    },
    [],
  );

  const executeTask = useCallback(async () => {
    if ((!prompt.trim() && attachments.length === 0) || isLoading) {
      return;
    }
    const taskId = `task_${Date.now()}`;
    const enrichedPrompt = buildPromptWithAttachments(prompt.trim(), attachments);
    const task = await startTask({
      prompt: enrichedPrompt,
      taskId,
      files: attachments,
      workingDirectory,
    });
    if (task) {
      setAttachments([]);
      setWorkingDirectory(undefined);
      navigate(`/execution/${task.id}`);
    }
  }, [
    prompt,
    attachments,
    workingDirectory,
    isLoading,
    startTask,
    navigate,
    buildPromptWithAttachments,
  ]);

  const handleSubmit = async () => {
    if (isLoading) {
      void interruptTask();
      return;
    }
    if (!prompt.trim() && attachments.length === 0) {
      return;
    }
    try {
      const isE2EMode = await accomplish.isE2EMode();
      if (!isE2EMode) {
        const settings = await accomplish.getProviderSettings();
        if (!hasAnyReadyProvider(settings)) {
          setSettingsInitialTab('providers');
          setShowSettingsDialog(true);
          return;
        }
      }
      await executeTask();
    } catch (err) {
      logger.error('Failed to submit task:', err);
    }
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setSettingsInitialTab('providers');
    }
  };

  const handleOpenSpeechSettings = useCallback(() => {
    setSettingsInitialTab('voice');
    setShowSettingsDialog(true);
  }, []);

  const handleOpenModelSettings = useCallback(() => {
    setSettingsInitialTab('providers');
    setShowSettingsDialog(true);
  }, []);

  const handleOpenSettings = useCallback((tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setShowSettingsDialog(true);
  }, []);

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim() || attachments.length > 0) {
      await executeTask();
    }
  };

  const focusPromptTextarea = () => {
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="task-input-textarea"]')?.focus();
    }, 0);
  };

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
    focusPromptTextarea();
  };

  const handleSkillSelect = (command: string) => {
    setPrompt((prev) => `${command} ${prev}`.trim());
    focusPromptTextarea();
  };

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const accepted = processFileAttachments(fileList, attachments.length);
      if (accepted.length > 0) {
        setAttachments((prev) => [...prev, ...accepted]);
      }
    },
    [attachments.length],
  );

  const handleAttachFiles = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      if (input.files) {
        addFiles(input.files);
      }
      input.remove();
    };
    input.click();
  }, [addFiles]);

  const displayedFavorites = showAllFavorites
    ? favoritesList
    : favoritesList.slice(0, FAVORITES_PREVIEW_COUNT);
  const hasMoreFavorites = favoritesList.length > FAVORITES_PREVIEW_COUNT;

  return {
    prompt,
    setPrompt,
    showAllFavorites,
    setShowAllFavorites,
    attachments,
    setAttachments,
    workingDirectory,
    setWorkingDirectory,
    showSettingsDialog,
    settingsInitialTab,
    favoritesList,
    removeFavorite,
    isLoading,
    useCaseExamples,
    displayedFavorites,
    hasMoreFavorites,
    handleSubmit,
    handleSettingsDialogChange,
    handleOpenSpeechSettings,
    handleOpenModelSettings,
    handleOpenSettings,
    handleApiKeySaved,
    handleExampleClick,
    handleSkillSelect,
    handleAttachFiles,
    addFiles,
    MAX_FILES,
  };
}
