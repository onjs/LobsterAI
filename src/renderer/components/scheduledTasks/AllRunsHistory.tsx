import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTaskRunWithName } from '../../../scheduled-task/types';
import { ClockIcon } from '@heroicons/react/24/outline';
import RunSessionModal from './RunSessionModal';
import { formatDateTime, formatDuration } from './utils';

const statusConfig: Record<string, { label: string; textColor: string; dotColor: string; badgeBg: string }> = {
  success: {
    label: 'scheduledTasksStatusSuccess',
    textColor: 'text-green-600 dark:text-green-400',
    dotColor: 'bg-green-500',
    badgeBg: 'bg-green-500/10',
  },
  error: {
    label: 'scheduledTasksStatusError',
    textColor: 'text-red-600 dark:text-red-400',
    dotColor: 'bg-red-500',
    badgeBg: 'bg-red-500/10',
  },
  skipped: {
    label: 'scheduledTasksStatusSkipped',
    textColor: 'text-yellow-600 dark:text-yellow-400',
    dotColor: 'bg-yellow-500',
    badgeBg: 'bg-yellow-500/10',
  },
  running: {
    label: 'scheduledTasksStatusRunning',
    textColor: 'text-blue-600 dark:text-blue-400',
    dotColor: 'bg-blue-500',
    badgeBg: 'bg-blue-500/10',
  },
};

const timeFilterOptions = [
  { value: 'day', label: 'scheduledTasksHistoryFilterDay', windowMs: 24 * 60 * 60 * 1000 },
  { value: 'week', label: 'scheduledTasksHistoryFilterWeek', windowMs: 7 * 24 * 60 * 60 * 1000 },
  { value: 'month', label: 'scheduledTasksHistoryFilterMonth', windowMs: 30 * 24 * 60 * 60 * 1000 },
] as const;

type TimeFilterValue = typeof timeFilterOptions[number]['value'];

const AllRunsHistory: React.FC = () => {
  const allRuns = useSelector((state: RootState) => state.scheduledTask.allRuns);
  const [viewingRun, setViewingRun] = useState<ScheduledTaskRunWithName | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>('day');

  useEffect(() => {
    scheduledTaskService.loadAllRuns(50);
  }, []);

  const handleLoadMore = () => {
    scheduledTaskService.loadAllRuns(50, allRuns.length);
  };

  const handleViewSession = (run: ScheduledTaskRunWithName) => {
    if (run.sessionId || run.sessionKey) {
      setViewingRun(run);
    }
  };

  const filteredRuns = useMemo(() => {
    const now = Date.now();
    const selectedWindow = timeFilterOptions.find((option) => option.value === timeFilter)?.windowMs ?? (24 * 60 * 60 * 1000);
    const startMs = now - selectedWindow;
    return allRuns.filter((run) => {
      const runMs = Date.parse(run.startedAt);
      if (!Number.isFinite(runMs) || runMs < startMs) return false;
      return true;
    });
  }, [allRuns, timeFilter]);

  if (allRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <ClockIcon className="h-12 w-12 dark:text-claude-darkTextSecondary/40 text-claude-textSecondary/40 mb-4" />
        <p className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {timeFilterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setTimeFilter(option.value)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              timeFilter === option.value
                ? 'bg-claude-accent text-white border-claude-accent'
                : 'dark:bg-claude-darkSurface bg-claude-surface dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover border dark:border-claude-darkBorder border-claude-border'
            }`}
          >
            {i18nService.t(option.label)}
          </button>
        ))}
      </div>

      {filteredRuns.length === 0 ? (
        <div className="rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/40 bg-claude-surface/40 p-6 text-center text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryNoFilteredResults')}
        </div>
      ) : (
        <div className="relative pl-8">
          <span className="absolute left-[11px] top-0 bottom-0 w-px dark:bg-claude-darkBorder bg-claude-border/80" />
          <div className="space-y-3">
            {filteredRuns.map((run) => {
              const cfg = statusConfig[run.status] || {
                label: '',
                textColor: 'dark:text-claude-darkTextSecondary text-claude-textSecondary',
                dotColor: 'bg-claude-border',
                badgeBg: 'bg-claude-surfaceHover dark:bg-claude-darkSurfaceHover',
              };
              const hasSession = Boolean(run.sessionId || run.sessionKey);

              return (
                <div key={run.id} className="relative">
                  <span className={`absolute -left-[24px] top-4 h-2.5 w-2.5 rounded-full ${cfg.dotColor} ${run.status === 'running' ? 'animate-pulse' : ''}`} />

                  <div className="rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/50 bg-claude-surface/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium dark:text-claude-darkText text-claude-text truncate">
                          {run.taskName}
                        </div>
                        <div className="mt-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                          {formatDateTime(new Date(run.startedAt))}
                          {run.durationMs !== null && (
                            <span className="ml-1.5">({formatDuration(run.durationMs)})</span>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.badgeBg} ${cfg.textColor}`}>
                        {i18nService.t(cfg.label)}
                      </span>
                    </div>

                    {run.status === 'error' && run.error && (
                      <div className="mt-2 text-xs text-red-600 dark:text-red-400 line-clamp-2" title={run.error}>
                        {run.error}
                      </div>
                    )}

                    {hasSession && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => handleViewSession(run)}
                          className="text-xs text-claude-accent hover:text-claude-accentHover transition-colors"
                        >
                          {i18nService.t('scheduledTasksViewSession')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {allRuns.length >= 50 && allRuns.length % 50 === 0 && (
            <button
              type="button"
              onClick={handleLoadMore}
              className="w-full py-3 text-sm text-claude-accent hover:text-claude-accentHover transition-colors"
            >
              {i18nService.t('scheduledTasksLoadMore')}
            </button>
          )}
        </div>
      )}

      {viewingRun && (
        <RunSessionModal
          sessionId={viewingRun.sessionId}
          sessionKey={viewingRun.sessionKey}
          onClose={() => setViewingRun(null)}
        />
      )}
    </div>
  );
};

export default AllRunsHistory;
