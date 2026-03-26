/**
 * IntegrationsPanel — container for messaging platform integrations
 *
 * Combines approach from:
 * - PR #611 (SaaiAravindhRaja): panel layout, i18n keys, platform scaffold
 * - PR #595 (aryan877): WhatsAppCard component
 * - PR #455 (kartikangiras): stub cards for future platforms
 */
import { useTranslation } from 'react-i18next';
import { WhatsAppCard } from './WhatsAppCard';

export function IntegrationsPanel() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4" data-testid="integrations-panel">
      {/* Section header */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="font-medium text-foreground">{t('integrations.title')}</div>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          {t('integrations.description')}
        </p>
      </div>

      {/* WhatsApp — fully implemented */}
      <WhatsAppCard />

      {/* Slack, Telegram, Teams — coming soon */}
      {(['Slack', 'Telegram', 'Microsoft Teams'] as const).map((name) => (
        <div
          key={name}
          className="rounded-lg border border-border/50 bg-card overflow-hidden opacity-60"
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-muted" />
              <div>
                <span className="font-medium text-foreground text-sm">{name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('integrations.comingSoon')}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('integrations.comingSoon')}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
