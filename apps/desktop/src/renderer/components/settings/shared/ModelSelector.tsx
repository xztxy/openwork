// apps/desktop/src/renderer/components/settings/shared/ModelSelector.tsx

interface Model {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  models: Model[];
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
  if (loading) {
    return (
      <div className="h-10 animate-pulse rounded-md bg-muted" />
    );
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">Model</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid="model-selector"
        className={`w-full rounded-md border bg-background px-3 py-2.5 text-sm ${
          error ? 'border-destructive' : 'border-input'
        }`}
      >
        <option value="" disabled>{placeholder}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      {error && !value && (
        <p className="mt-2 text-sm text-destructive" data-testid="model-selector-error">{errorMessage}</p>
      )}
    </div>
  );
}
