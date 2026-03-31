import { useTranslation } from 'react-i18next';
import type { ToolSupportStatus } from '@accomplish_ai/agent-core/common';
import { ModelSelector, ToolSupportBadge } from '../shared';
import type { LMStudioModel } from './useLMStudioProviderConnect';

export function LMStudioModelSelector({
  models,
  value,
  onChange,
  error,
}: {
  models: LMStudioModel[];
  value: string | null;
  onChange: (modelId: string) => void;
  error: boolean;
}) {
  const { t } = useTranslation('settings');
  const sortedModels = [...models].sort((a, b) => {
    const order: Record<ToolSupportStatus, number> = { supported: 0, unknown: 1, unsupported: 2 };
    return order[a.toolSupport] - order[b.toolSupport];
  });

  const selectorModels = sortedModels.map((model) => {
    const toolIcon =
      model.toolSupport === 'supported' ? '✓' : model.toolSupport === 'unsupported' ? '✗' : '?';
    return { id: `lmstudio/${model.id}`, name: `${model.name} ${toolIcon}` };
  });

  const selectedModel = models.find((m) => `lmstudio/${m.id}` === value);
  const hasUnsupportedSelected = selectedModel?.toolSupport === 'unsupported';
  const hasUnknownSelected = selectedModel?.toolSupport === 'unknown';

  return (
    <div>
      <ModelSelector
        models={selectorModels}
        value={value}
        onChange={onChange}
        error={error}
        errorMessage={t('common.pleaseSelectModel')}
        placeholder={t('common.selectModel')}
      />
      {hasUnsupportedSelected && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <svg
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="font-medium">{t('common.toolUnsupported')}</p>
            <p className="text-red-400/80 mt-1">{t('common.toolUnsupportedDetail')}</p>
          </div>
        </div>
      )}
      {hasUnknownSelected && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
          <svg
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-medium">{t('common.toolUnknown')}</p>
            <p className="text-yellow-400/80 mt-1">{t('common.toolUnknownDetail')}</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ToolSupportBadge status="supported" t={t} />
          <span>{t('common.functionCallingVerified')}</span>
        </span>
      </div>
    </div>
  );
}
