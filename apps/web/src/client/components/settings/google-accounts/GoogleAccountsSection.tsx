import { useEffect, useState } from 'react';
import { GoogleAccountCard } from './GoogleAccountCard';
import { GoogleLabelDialog } from './GoogleLabelDialog';
import { useGoogleAccountStore, initGoogleAccountListener } from '@/stores/googleAccountStore';
import { Button } from '@/components/ui/button';

export function GoogleAccountsSection() {
  const { accounts, loading, fetchAccounts, removeAccount } = useGoogleAccountStore();
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reconnectId, setReconnectId] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = initGoogleAccountListener();
    fetchAccounts();
    return cleanup;
  }, [fetchAccounts]);

  const openAuth = async (label: string): Promise<void> => {
    setConnecting(true);
    try {
      const result = await window.accomplish?.gws?.startAuth(label);
      if (result?.authUrl && result.authUrl.length > 0) {
        if (window.accomplish?.openExternal) {
          await window.accomplish.openExternal(result.authUrl);
        } else {
          window.open(result.authUrl, '_blank');
        }
        // Refresh after a short delay to pick up the new account if auth completes quickly
        setTimeout(() => {
          fetchAccounts();
          setConnecting(false);
        }, 3000);
      } else {
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  };

  const handleAddConfirm = async (label: string): Promise<void> => {
    setLabelDialogOpen(false);
    await openAuth(label);
  };

  const handleReconnect = async (id: string): Promise<void> => {
    const account = accounts.find((a) => a.googleAccountId === id);
    if (!account) {
      return;
    }
    setReconnectId(id);
    await openAuth(account.label);
    setReconnectId(null);
  };

  const handleCancelConnecting = () => {
    setConnecting(false);
  };

  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Google Accounts
      </h4>

      {loading && accounts.length === 0 ? (
        <div className="flex h-[80px] items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading accounts...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-8">
          <p className="text-sm text-muted-foreground">No Google accounts connected</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLabelDialogOpen(true)}
            disabled={connecting}
          >
            Add Google Account
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <GoogleAccountCard
              key={account.googleAccountId}
              account={account}
              onDisconnect={removeAccount}
              onReconnect={handleReconnect}
            />
          ))}
          <div className="mt-2 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLabelDialogOpen(true)}
              disabled={connecting || !!reconnectId}
            >
              Add Google Account
            </Button>
            {connecting && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Waiting for Google...</span>
                <Button variant="ghost" size="sm" onClick={handleCancelConnecting}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {connecting && accounts.length === 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Waiting for Google...</span>
          <Button variant="ghost" size="sm" onClick={handleCancelConnecting}>
            Cancel
          </Button>
        </div>
      )}

      <GoogleLabelDialog
        open={labelDialogOpen}
        onConfirm={handleAddConfirm}
        onCancel={() => setLabelDialogOpen(false)}
      />
    </div>
  );
}
