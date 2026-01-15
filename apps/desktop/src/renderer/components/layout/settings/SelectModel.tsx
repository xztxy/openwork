'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { getAccomplish } from '@/lib/accomplish';
import { analytics } from '@/lib/analytics';
import { DEFAULT_PROVIDERS } from '@accomplish/shared';
import type { ProviderId } from './types';

interface SelectModelProps {
  providerId: ProviderId;
  onDone: (modelName: string) => void;
  onBack: () => void;
}

export default function SelectModel({ providerId, onDone, onBack }: SelectModelProps) {
  const { t } = useTranslation();
  const [selectedModel, setSelectedModel] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const provider = DEFAULT_PROVIDERS.find((p) => p.id === providerId);
  const models = provider?.models || [];

  const handleDone = async () => {
    if (!selectedModel) return;

    setIsSaving(true);
    try {
      const accomplish = getAccomplish();
      const model = models.find((m) => m.fullId === selectedModel);

      await accomplish.setSelectedModel({
        provider: providerId,
        model: selectedModel,
      });

      analytics.trackSelectModel(model?.displayName || selectedModel);
      onDone(model?.displayName || selectedModel);
    } catch (err) {
      console.error('Failed to save model:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-foreground">
        {t('settings.wizard.selectModel', 'Select Model')}
      </h2>
      <select
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="" disabled>
          {t('settings.model.selectModel', 'Select a model...')}
        </option>
        {models.map((model) => (
          <option key={model.fullId} value={model.fullId}>
            {model.displayName}
          </option>
        ))}
      </select>
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('settings.wizard.back', 'Back')}
        </button>
        <button
          type="button"
          onClick={handleDone}
          disabled={!selectedModel || isSaving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? t('settings.model.saving', 'Saving...') : t('settings.wizard.done', 'Done')}
        </button>
      </div>
    </div>
  );
}
