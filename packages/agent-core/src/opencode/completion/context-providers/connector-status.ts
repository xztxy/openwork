/**
 * Built-in Connector Status Section
 *
 * Pure formatting function for the system prompt connector status block.
 * Receives connection state from the desktop layer (which reads from auth stores)
 * and returns a formatted string for injection into the agent's system prompt.
 *
 * This keeps agent-core free of desktop dependencies while enabling
 * the agent to know the live connection status of all 8 built-in connectors.
 */

export interface BuiltInConnectorStatus {
  displayName: string;
  connected: boolean;
}

/**
 * Formats an array of connector statuses into a system prompt section.
 *
 * Returns an empty string if no statuses are provided (connector status
 * injection is opt-in from the desktop config generator).
 *
 * Example output:
 * ```
 * <connected-integrations>
 * Jira: connected. GitHub: not connected. Notion: not connected. ...
 * Use @<name> to reference a connector (e.g. "@Jira"). Only connected
 * connectors have active MCP tools available.
 * </connected-integrations>
 * ```
 */
export function formatBuiltInConnectorStatusSection(
  statuses: readonly BuiltInConnectorStatus[],
): string {
  if (statuses.length === 0) {
    return '';
  }

  const statusLine = statuses
    .map((s) => `${s.displayName}: ${s.connected ? 'connected' : 'not connected'}`)
    .join('. ');

  return `

<connected-integrations>
##############################################################################
# CONNECTED INTEGRATIONS
##############################################################################

${statusLine}.

Use @<name> to reference an integration (e.g. "@Jira", "@GitHub"). Only connected
integrations have active MCP tools available for this task.

##############################################################################
</connected-integrations>`;
}
