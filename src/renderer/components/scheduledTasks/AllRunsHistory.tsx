import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTaskRunWithName } from '../../../scheduledTask/types';
import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from '@heroicons/react/24/outline';
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
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

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

  const groupedRuns = useMemo(() => {
    const byTask = new Map<string, { taskId: string; taskName: string; runs: ScheduledTaskRunWithName[]; latestMs: number }>();
    filteredRuns.forEach((run) => {
      const taskId = run.taskId || `unknown-${run.taskName || ''}`;
      const taskName = run.taskName?.trim() || i18nService.t('scheduledTasksNotSet');
      const runMs = Date.parse(run.startedAt);
      const existing = byTask.get(taskId);
      if (!existing) {
        byTask.set(taskId, {
          taskId,
          taskName,
          runs: [run],
          latestMs: Number.isFinite(runMs) ? runMs : 0,
        });
        return;
      }
      existing.runs.push(run);
      if (Number.isFinite(runMs) && runMs > existing.latestMs) {
        existing.latestMs = runMs;
      }
    });

    return Array.from(byTask.values())
      .map((group) => ({
        ...group,
        runs: [...group.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
      }))
      .sort((a, b) => b.latestMs - a.latestMs);
  }, [filteredRuns]);

  useEffect(() => {
    setExpandedTaskIds((prev) => {
      const availableIds = new Set(groupedRuns.map((group) => group.taskId));
      const next = new Set<string>();
      groupedRuns.forEach((group) => {
        if (prev.size === 0 || prev.has(group.taskId)) {
          next.add(group.taskId);
        }
      });
      Array.from(prev).forEach((id) => {
        if (availableIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [groupedRuns]);

  const toggleTaskGroup = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

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
        <div>
          <div className="mb-2 flex items-center gap-1 text-sm font-medium dark:text-claude-darkText text-claude-text">
            <span>{i18nService.t('scheduledTasks')}</span>
          </div>

          <div className="space-y-3">
            {groupedRuns.map((group) => {
              const isExpanded = expandedTaskIds.has(group.taskId);
              return (
                <div
                  key={group.taskId}
                  className="rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/40 bg-claude-surface/40 p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleTaskGroup(group.taskId)}
                    className="w-full flex items-center gap-2 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                    )}
                    <ClockIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                    <span className="min-w-0 flex-1 truncate text-base font-semibold dark:text-claude-darkText text-claude-text">
                      {group.taskName}
                    </span>
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-medium dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary">
                      {group.runs.length}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 ml-5 border-l dark:border-claude-darkBorder/80 border-claude-border/80 pl-4 space-y-2">
                      {group.runs.map((run) => {
                        const cfg = statusConfig[run.status] || {
                          label: '',
                          textColor: 'dark:text-claude-darkTextSecondary text-claude-textSecondary',
                          dotColor: 'bg-claude-border',
                          badgeBg: 'bg-claude-surfaceHover dark:bg-claude-darkSurfaceHover',
                        };
                        const hasSession = Boolean(run.sessionId || run.sessionKey);
                        return (
                          <div key={run.id} className="relative rounded-lg dark:bg-claude-darkSurface/60 bg-claude-surface/60 p-2.5">
                            <span className={`absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full ${cfg.dotColor} ${run.status === 'running' ? 'animate-pulse' : ''}`} />
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm dark:text-claude-darkText text-claude-text truncate">
                                  {formatDateTime(new Date(run.startedAt))}
                                </div>
                                {run.durationMs !== null && (
                                  <div className="mt-0.5 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                                    {formatDuration(run.durationMs)}
                                  </div>
                                )}
                              </div>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.badgeBg} ${cfg.textColor}`}>
                                {i18nService.t(cfg.label)}
                              </span>
                            </div>

                            {run.status === 'error' && run.error && (
                              <div className="mt-1.5 text-xs text-red-600 dark:text-red-400 line-clamp-2" title={run.error}>
                                {run.error}
                              </div>
                            )}

                            {hasSession && (
                              <button
                                type="button"
                                onClick={() => handleViewSession(run)}
                                className="mt-1.5 text-xs text-claude-accent hover:text-claude-accentHover transition-colors"
                              >
                                {i18nService.t('scheduledTasksViewSession')}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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
