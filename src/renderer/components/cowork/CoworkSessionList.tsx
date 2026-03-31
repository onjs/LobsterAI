import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import type { CoworkSessionStatus, CoworkSessionSummary } from '../../types/cowork';
import CoworkSessionItem from './CoworkSessionItem';
import { i18nService } from '../../services/i18n';
import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from '@heroicons/react/24/outline';

interface CoworkSessionListProps {
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  showBatchOption?: boolean;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
}

const SCHEDULED_TITLE_PREFIX = '[Scheduled]';

const statusLabels: Record<CoworkSessionStatus, string> = {
  idle: 'coworkStatusIdle',
  running: 'coworkStatusRunning',
  completed: 'coworkStatusCompleted',
  error: 'coworkStatusError',
};

function parseScheduledTaskName(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed.startsWith(SCHEDULED_TITLE_PREFIX)) return null;
  const name = trimmed.slice(SCHEDULED_TITLE_PREFIX.length).trim();
  return name || i18nService.t('scheduledTasksNotSet');
}

function formatRunTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return i18nService.t('scheduledTasksNotSet');
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

const CoworkSessionList: React.FC<CoworkSessionListProps> = ({
  sessions,
  currentSessionId,
  isBatchMode,
  selectedIds,
  showBatchOption = true,
  onSelectSession,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onToggleSelection,
  onEnterBatchMode,
}) => {
  const unreadSessionIds = useSelector((state: RootState) => state.cowork.unreadSessionIds);
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const [scheduledExpanded, setScheduledExpanded] = useState(true);
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<Set<string>>(new Set());

  const sortedSessions = useMemo(() => {
    const sortByRecentActivity = (a: CoworkSessionSummary, b: CoworkSessionSummary) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      return b.createdAt - a.createdAt;
    };

    const pinnedSessions = sessions
      .filter((session) => session.pinned)
      .sort(sortByRecentActivity);
    const unpinnedSessions = sessions
      .filter((session) => !session.pinned)
      .sort(sortByRecentActivity);
    return [...pinnedSessions, ...unpinnedSessions];
  }, [sessions]);

  const { scheduledGroups, manualSessions } = useMemo(() => {
    const groupMap = new Map<string, CoworkSessionSummary[]>();
    const manual: CoworkSessionSummary[] = [];
    sortedSessions.forEach((session) => {
      const scheduledTaskName = parseScheduledTaskName(session.title);
      if (!scheduledTaskName) {
        manual.push(session);
        return;
      }
      const bucket = groupMap.get(scheduledTaskName) ?? [];
      bucket.push(session);
      groupMap.set(scheduledTaskName, bucket);
    });

    const groups = Array.from(groupMap.entries())
      .map(([taskName, taskSessions]) => ({
        taskName,
        sessions: [...taskSessions].sort((a, b) => b.updatedAt - a.updatedAt),
        latestUpdatedAt: Math.max(...taskSessions.map((session) => session.updatedAt)),
      }))
      .sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

    return {
      scheduledGroups: groups,
      manualSessions: manual,
    };
  }, [sortedSessions]);

  useEffect(() => {
    setExpandedTaskGroups((prev) => {
      if (scheduledGroups.length === 0) return new Set();
      const validNames = new Set(scheduledGroups.map((group) => group.taskName));
      const next = new Set<string>();
      if (prev.size === 0) {
        scheduledGroups.forEach((group) => next.add(group.taskName));
        return next;
      }
      prev.forEach((name) => {
        if (validNames.has(name)) next.add(name);
      });
      return next;
    });
  }, [scheduledGroups]);

  const toggleTaskGroup = (taskName: string) => {
    setExpandedTaskGroups((prev) => {
      const next = new Set(prev);
      if (next.has(taskName)) next.delete(taskName);
      else next.add(taskName);
      return next;
    });
  };

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('coworkNoSessions')}
        </p>
      </div>
    );
  }

  if (isBatchMode) {
    return (
      <div className="space-y-2">
        {sortedSessions.map((session) => (
          <CoworkSessionItem
            key={session.id}
            session={session}
            hasUnread={unreadSessionIdSet.has(session.id)}
            isActive={session.id === currentSessionId}
            isBatchMode={isBatchMode}
            isSelected={selectedIds.has(session.id)}
            showBatchOption={showBatchOption}
            onSelect={() => onSelectSession(session.id)}
            onDelete={() => onDeleteSession(session.id)}
            onTogglePin={(pinned) => onTogglePin(session.id, pinned)}
            onRename={(title) => onRenameSession(session.id, title)}
            onToggleSelection={() => onToggleSelection(session.id)}
            onEnterBatchMode={() => onEnterBatchMode(session.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scheduledGroups.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setScheduledExpanded((prev) => !prev)}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            {scheduledExpanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            )}
            <span className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('scheduledTasks')}
            </span>
          </button>

          {scheduledExpanded && (
            <div className="mt-1 space-y-1 pl-1">
              {scheduledGroups.map((group) => {
                const isExpanded = expandedTaskGroups.has(group.taskName);
                return (
                  <div key={group.taskName}>
                    <button
                      type="button"
                      onClick={() => toggleTaskGroup(group.taskName)}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDownIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                      ) : (
                        <ChevronRightIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                      )}
                      <ClockIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium dark:text-claude-darkText text-claude-text">
                        {group.taskName}
                      </span>
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary">
                        {group.sessions.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="ml-7 mt-1 border-l dark:border-claude-darkBorder border-claude-border pl-3 space-y-1">
                        {group.sessions.map((session) => {
                          const isActive = session.id === currentSessionId;
                          return (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => onSelectSession(session.id)}
                              className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${
                                isActive
                                  ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                                  : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                              }`}
                            >
                              <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary truncate">
                                {formatRunTime(session.updatedAt)}
                              </div>
                              <div className="mt-0.5 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                                {i18nService.t(statusLabels[session.status])}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="px-2 pb-1 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('coworkManualTasks')}
        </div>
        {manualSessions.length === 0 ? (
          <div className="px-2 py-2 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('coworkNoSessions')}
          </div>
        ) : (
          <div className="space-y-2">
            {manualSessions.map((session) => (
              <CoworkSessionItem
                key={session.id}
                session={session}
                hasUnread={unreadSessionIdSet.has(session.id)}
                isActive={session.id === currentSessionId}
                isBatchMode={false}
                isSelected={selectedIds.has(session.id)}
                showBatchOption={showBatchOption}
                onSelect={() => onSelectSession(session.id)}
                onDelete={() => onDeleteSession(session.id)}
                onTogglePin={(pinned) => onTogglePin(session.id, pinned)}
                onRename={(title) => onRenameSession(session.id, title)}
                onToggleSelection={() => onToggleSelection(session.id)}
                onEnterBatchMode={() => onEnterBatchMode(session.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CoworkSessionList;
