export const ScheduledSessionTitlePrefix = {
  LegacyScheduled: '[Scheduled]',
} as const;

const ScheduledSessionMarker = {
  Scheduled: 'scheduled',
  Cron: 'cron',
  ChineseCron: '定时',
  CronWithIdPrefix: 'cron:',
} as const;

const BRACKETED_TITLE_PATTERN = /^\[([^\]]+)\]\s*(.*)$/;

export const parseScheduledSessionTitle = (
  title: string,
  options?: { fallbackName?: string },
): string | null => {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const bracketedMatch = trimmed.match(BRACKETED_TITLE_PATTERN);
  if (!bracketedMatch) {
    return null;
  }

  const marker = bracketedMatch[1].trim();
  const payload = bracketedMatch[2].trim();
  const markerLower = marker.toLowerCase();

  if (
    markerLower === ScheduledSessionMarker.Scheduled
    || markerLower === ScheduledSessionMarker.Cron
    || marker === ScheduledSessionMarker.ChineseCron
  ) {
    return payload || options?.fallbackName || null;
  }

  if (markerLower.startsWith(ScheduledSessionMarker.CronWithIdPrefix)) {
    return payload || marker;
  }

  return null;
};
