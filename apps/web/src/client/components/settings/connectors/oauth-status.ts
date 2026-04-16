export const oauthStatusTextClass = {
  connected: 'text-success',
  disconnected: 'text-muted-foreground',
  pending: 'text-warning',
} as const;

export const oauthStatusDotClass = {
  connected: 'bg-success',
  disconnected: 'bg-muted-foreground',
  pending: 'bg-warning animate-pulse',
} as const;

export type OAuthStatusKey = keyof typeof oauthStatusTextClass;

export function getOAuthStatusKey(authState: {
  connected: boolean;
  pendingAuthorization: boolean;
}): OAuthStatusKey {
  return authState.connected
    ? 'connected'
    : authState.pendingAuthorization
      ? 'pending'
      : 'disconnected';
}
