import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import type { CoworkSessionStatus, CoworkSessionSummary } from '../../types/cowork';
import type { IMPlatform } from '../../types/im';
import CoworkSessionItem from './CoworkSessionItem';
import { i18nService } from '../../services/i18n';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

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
const IM_SESSION_CHANNELS = [
  'dingtalk',
  'feishu',
  'telegram',
  'discord',
  'qqbot',
  'wecom',
  'popo',
  'nim',
  'openclaw-weixin',
  'xiaomifeng',
] as const;
const IM_PLATFORM_ORDER: readonly IMPlatform[] = [
  'dingtalk',
  'feishu',
  'wecom',
  'weixin',
  'qq',
  'popo',
  'nim',
  'xiaomifeng',
  'telegram',
  'discord',
];
const IM_PLATFORM_LABEL_KEYS: Record<IMPlatform, string> = {
  dingtalk: 'scheduledTasksFormNotifyDingtalk',
  feishu: 'scheduledTasksFormNotifyFeishu',
  qq: 'scheduledTasksFormNotifyQq',
  telegram: 'scheduledTasksFormNotifyTelegram',
  discord: 'scheduledTasksFormNotifyDiscord',
  nim: 'scheduledTasksFormNotifyNim',
  xiaomifeng: 'scheduledTasksFormNotifyXiaomifeng',
  wecom: 'scheduledTasksFormNotifyWecom',
  popo: 'scheduledTasksFormNotifyPopo',
  weixin: 'scheduledTasksFormNotifyWeixin',
};
const IM_PLATFORM_LOGOS: Record<IMPlatform, string> = {
  dingtalk: 'dingding.png',
  feishu: 'feishu.png',
  qq: 'qq_bot.jpeg',
  telegram: 'telegram.svg',
  discord: 'discord.svg',
  nim: 'nim.png',
  xiaomifeng: 'xiaomifeng.png',
  weixin: 'weixin.png',
  wecom: 'wecom.png',
  popo: 'popo.png',
};
const IM_PLATFORM_SET = new Set<IMPlatform>(IM_PLATFORM_ORDER);

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

function isImPlatform(value: string): value is IMPlatform {
  return IM_PLATFORM_SET.has(value as IMPlatform);
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
  const [imExpanded, setImExpanded] = useState(true);
  const [manualExpanded, setManualExpanded] = useState(true);
  const [imSessionPlatformMap, setImSessionPlatformMap] = useState<Record<string, IMPlatform>>({});
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

  const sessionIdsKey = useMemo(
    () => sortedSessions.map((session) => session.id).sort().join('|'),
    [sortedSessions],
  );

  useEffect(() => {
    let disposed = false;
    const loadImSessionMappings = async () => {
      if (!sessionIdsKey) {
        if (!disposed) setImSessionPlatformMap({});
        return;
      }
      const listConversations = window.electron?.scheduledTasks?.listChannelConversations;
      if (!listConversations) {
        if (!disposed) setImSessionPlatformMap({});
        return;
      }
      try {
        const results = await Promise.all(
          IM_SESSION_CHANNELS.map((channel) => listConversations(channel)),
        );
        if (disposed) return;

        const nextMap: Record<string, IMPlatform> = {};
        for (const result of results) {
          if (!result?.success || !Array.isArray(result.conversations)) continue;
          for (const conversation of result.conversations) {
            const platform = typeof conversation.platform === 'string' ? conversation.platform : '';
            if (!conversation.coworkSessionId || !isImPlatform(platform)) continue;
            nextMap[conversation.coworkSessionId] = platform;
          }
        }
        setImSessionPlatformMap(nextMap);
      } catch (error) {
        console.warn('[CoworkSessionList] Failed to load IM session mappings:', error);
      }
    };

    void loadImSessionMappings();
    return () => {
      disposed = true;
    };
  }, [sessionIdsKey]);

  const { imGroups, scheduledGroups, manualSessions } = useMemo(() => {
    const imGroupMap = new Map<IMPlatform, CoworkSessionSummary[]>();
    const groupMap = new Map<string, CoworkSessionSummary[]>();
    const manual: CoworkSessionSummary[] = [];
    sortedSessions.forEach((session) => {
      const scheduledTaskName = parseScheduledTaskName(session.title);
      if (scheduledTaskName) {
        const bucket = groupMap.get(scheduledTaskName) ?? [];
        bucket.push(session);
        groupMap.set(scheduledTaskName, bucket);
        return;
      }
      const imPlatform = imSessionPlatformMap[session.id];
      if (imPlatform) {
        const bucket = imGroupMap.get(imPlatform) ?? [];
        bucket.push(session);
        imGroupMap.set(imPlatform, bucket);
        return;
      }
      manual.push(session);
    });

    const platformGroups = IM_PLATFORM_ORDER
      .map((platform) => {
        const taskSessions = imGroupMap.get(platform);
        if (!taskSessions || taskSessions.length === 0) return null;
        return {
          platform,
          labelKey: IM_PLATFORM_LABEL_KEYS[platform],
          sessions: [...taskSessions].sort((a, b) => b.updatedAt - a.updatedAt),
        };
      })
      .filter((group): group is {
        platform: IMPlatform;
        labelKey: string;
        sessions: CoworkSessionSummary[];
      } => group !== null);

    const groups = Array.from(groupMap.entries())
      .map(([taskName, taskSessions]) => ({
        taskName,
        sessions: [...taskSessions].sort((a, b) => b.updatedAt - a.updatedAt),
        latestUpdatedAt: Math.max(...taskSessions.map((session) => session.updatedAt)),
      }))
      .sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

    return {
      imGroups: platformGroups,
      scheduledGroups: groups,
      manualSessions: manual,
    };
  }, [sortedSessions, imSessionPlatformMap]);

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
      {imGroups.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setImExpanded((prev) => !prev)}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            {imExpanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            )}
            <span className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('coworkImTasks')}
            </span>
          </button>

          {imExpanded && (
            <div className="mt-1 space-y-1 pl-1">
              {imGroups.map((group) => {
                const activeSessionInGroup = group.sessions.find((session) => session.id === currentSessionId) ?? null;
                const targetSession = activeSessionInGroup ?? group.sessions[0];
                const isActive = Boolean(activeSessionInGroup);
                const label = `${i18nService.t('coworkMyPrefix')}${i18nService.t(group.labelKey)}`;
                const logo = IM_PLATFORM_LOGOS[group.platform];
                return (
                  <div key={group.platform}>
                    <button
                      type="button"
                      onClick={() => onSelectSession(targetSession.id)}
                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        isActive
                          ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                          : 'hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
                      }`}
                    >
                      <div className="flex h-6 w-6 items-center justify-center">
                        <img src={logo} alt={i18nService.t(group.platform)} className="h-5 w-5 object-contain rounded" />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium dark:text-claude-darkText text-claude-text">
                        {label}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
        <button
          type="button"
          onClick={() => setManualExpanded((prev) => !prev)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
        >
          {manualExpanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          )}
          <span className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('coworkManualTasks')}
          </span>
        </button>

        {manualExpanded && (
          manualSessions.length === 0 ? (
            <div className="px-2 py-2 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('coworkNoSessions')}
            </div>
          ) : (
            <div className="mt-1 space-y-1 pl-1">
              {manualSessions.map((session) => {
                const isActive = session.id === currentSessionId;
                return (
                  <div key={session.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        isActive
                          ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                          : 'hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium dark:text-claude-darkText text-claude-text">
                        {session.title}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default CoworkSessionList;
