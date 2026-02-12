import { useMemo } from 'react';
import { SearchableSelect, type SelectItem } from '@/components/ui/searchable-select';

const TIER_PRIORITY: Record<string, number> = { opus: 3, sonnet: 2, haiku: 1 };

function sortModels(models: SelectItem[]): SelectItem[] {
  return [...models].sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();

    const versionA = parseFloat(nameA.match(/(\d+(?:\.\d+)?)\s*$/)?.[1] ?? '');
    const versionB = parseFloat(nameB.match(/(\d+(?:\.\d+)?)\s*$/)?.[1] ?? '');

    if (!isNaN(versionA) && !isNaN(versionB) && versionA !== versionB) {
      return versionB - versionA;
    }

    const tierA = Object.entries(TIER_PRIORITY).find(([t]) => nameA.includes(t))?.[1] ?? 0;
    const tierB = Object.entries(TIER_PRIORITY).find(([t]) => nameB.includes(t))?.[1] ?? 0;
    if (tierA !== tierB) {
      return tierB - tierA;
    }

    return nameA.localeCompare(nameB);
  });
}

interface ModelSelectorProps {
  models: SelectItem[];
  value: string | null;
  onChange: (modelId: string) => void;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  placeholder?: string;
}

export function ModelSelector({
  models,
  value,
  onChange,
  loading,
  error,
  errorMessage = 'Please select a model',
  placeholder = 'Select model...',
}: ModelSelectorProps) {
  const sortedModels = useMemo(() => sortModels(models), [models]);

  return (
    <SearchableSelect
      items={sortedModels}
      value={value}
      onChange={onChange}
      label="Model"
      placeholder={placeholder}
      searchPlaceholder="Search models..."
      emptyMessage="No models found"
      loading={loading}
      error={error}
      errorMessage={error && !value ? errorMessage : undefined}
      testId="model-selector"
    />
  );
}
