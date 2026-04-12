export interface CalendarSummary {
  events: string[];
  period: string;
}

export function buildCalendarSummary(rawSnapshot: string, url: string): CalendarSummary {
  const period = extractCalendarPeriod(url);
  const events = extractEventTitles(rawSnapshot);
  return { events, period };
}

function extractCalendarPeriod(url: string): string {
  try {
    const u = new URL(url);
    const view = u.searchParams.get('view') || 'month';
    return `Calendar view: ${view}`;
  } catch {
    return 'Calendar view: unknown';
  }
}

function extractEventTitles(snapshot: string): string[] {
  const titles: string[] = [];
  const lines = snapshot.split('\n');
  for (const line of lines) {
    if (line.includes('button') || line.includes('link')) {
      const match = line.match(/"([^"]{3,80})"/);
      if (match) titles.push(match[1]);
    }
  }
  return titles.slice(0, 20);
}
