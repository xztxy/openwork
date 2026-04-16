export interface DatadogRegion {
  id: string;
  label: string;
  webUiHost: string;
  mcpUrl: string;
}

export const DATADOG_REGIONS: DatadogRegion[] = [
  {
    id: 'us1',
    label: 'US1',
    webUiHost: 'app.datadoghq.com',
    mcpUrl: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  {
    id: 'us3',
    label: 'US3',
    webUiHost: 'us3.datadoghq.com',
    mcpUrl: 'https://mcp.us3.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  {
    id: 'us5',
    label: 'US5',
    webUiHost: 'us5.datadoghq.com',
    mcpUrl: 'https://mcp.us5.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  {
    id: 'eu',
    label: 'EU',
    webUiHost: 'app.datadoghq.eu',
    mcpUrl: 'https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp',
  },
  {
    id: 'ap1',
    label: 'AP1',
    webUiHost: 'ap1.datadoghq.com',
    mcpUrl: 'https://mcp.ap1.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  {
    id: 'ap2',
    label: 'AP2',
    webUiHost: 'ap2.datadoghq.com',
    mcpUrl: 'https://mcp.ap2.datadoghq.com/api/unstable/mcp-server/mcp',
  },
];

export function findDatadogRegionByMcpUrl(
  url: string | null | undefined,
): DatadogRegion | undefined {
  if (!url) {
    return undefined;
  }
  const normalized = url.replace(/\/+$/, '');
  return DATADOG_REGIONS.find((r) => r.mcpUrl.replace(/\/+$/, '') === normalized);
}
