import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import type { CoworkSessionStatus, CoworkSessionSummary } from '../../types/cowork';
import type { IMPlatform } from '../../types/im';
import { ScheduledSessionTitlePrefix, parseScheduledSessionTitle } from '../../utils/scheduledSessionTitle';
import CoworkSessionItem from './CoworkSessionItem';
import { i18nService } from '../../services/i18n';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  EllipsisHorizontalIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface CoworkSessionListProps {
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  showBatchOption?: boolean;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onRenameSession: (sessionId: string, title: string) => void | Promise<void>;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
}

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
const MenuTargetType = {
  Session: 'session',
  ImGroup: 'im_group',
  ScheduledGroup: 'scheduled_group',
} as const;
type MenuTargetType = typeof MenuTargetType[keyof typeof MenuTargetType];

type SessionMenuTarget = {
  type: typeof MenuTargetType.Session;
  key: string;
  displayName: string;
  session: CoworkSessionSummary;
};

type ImGroupMenuTarget = {
  type: typeof MenuTargetType.ImGroup;
  key: string;
  displayName: string;
  platform: IMPlatform;
  sessions: CoworkSessionSummary[];
};

type ScheduledGroupMenuTarget = {
  type: typeof MenuTargetType.ScheduledGroup;
  key: string;
  displayName: string;
  taskName: string;
  sessions: CoworkSessionSummary[];
};

type MenuTarget = SessionMenuTarget | ImGroupMenuTarget | ScheduledGroupMenuTarget;

const statusLabels: Record<CoworkSessionStatus, string> = {
  idle: 'coworkStatusIdle',
  running: 'coworkStatusRunning',
  completed: 'coworkStatusCompleted',
  error: 'coworkStatusError',
};

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

const IM_GROUP_LABEL_STORAGE_KEY = 'cowork.imGroupDisplayNames';

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
  const [activeMenuTarget, setActiveMenuTarget] = useState<MenuTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<MenuTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MenuTarget | null>(null);
  const [isRenamingSaving, setIsRenamingSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [imGroupDisplayNames, setImGroupDisplayNames] = useState<Partial<Record<IMPlatform, string>>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IM_GROUP_LABEL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Partial<Record<IMPlatform, string>> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (!isImPlatform(key)) return;
        if (typeof value !== 'string') return;
        const normalized = value.trim();
        if (!normalized) return;
        next[key] = normalized;
      });
      setImGroupDisplayNames(next);
    } catch (error) {
      console.warn('[CoworkSessionList] Failed to load IM group display names:', error);
    }
  }, []);

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
      const scheduledTaskName = parseScheduledSessionTitle(session.title, {
        fallbackName: i18nService.t('scheduledTasksNotSet'),
      });
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

  const closeMenu = () => {
    setActiveMenuTarget(null);
  };

  const closeRenameDialog = () => {
    if (isRenamingSaving) return;
    setRenameTarget(null);
    setRenameValue('');
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
  };

  useEffect(() => {
    if (!activeMenuTarget) return undefined;

    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-cowork-session-menu-root="true"]')) return;
      closeMenu();
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleGlobalPointerDown);
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleGlobalPointerDown);
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [activeMenuTarget]);

  const openMenu = (event: React.MouseEvent | React.KeyboardEvent, target: MenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveMenuTarget((prev) => (prev?.key === target.key ? null : target));
  };

  const getRenameInitialValue = (target: MenuTarget): string => {
    if (target.type === MenuTargetType.Session) return target.session.title;
    if (target.type === MenuTargetType.ImGroup) return target.displayName;
    return target.taskName;
  };

  const handleMenuRename = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeMenuTarget) return;
    setRenameTarget(activeMenuTarget);
    setRenameValue(getRenameInitialValue(activeMenuTarget));
    closeMenu();
  };

  const runRename = async (sessionId: string, title: string) => {
    const result = await Promise.resolve(onRenameSession(sessionId, title) as unknown);
    if (result === false) {
      throw new Error('rename session returned false');
    }
  };

  const handleConfirmRename = async () => {
    if (!renameTarget) return;

    const trimmedValue = renameValue.trim();
    if (!trimmedValue) {
      closeRenameDialog();
      return;
    }

    const previousValue = getRenameInitialValue(renameTarget).trim();
    if (trimmedValue === previousValue) {
      closeRenameDialog();
      return;
    }

    setIsRenamingSaving(true);
    try {
      if (renameTarget.type === MenuTargetType.Session) {
        await runRename(renameTarget.session.id, trimmedValue);
      } else if (renameTarget.type === MenuTargetType.ImGroup) {
        setImGroupDisplayNames((prev) => {
          const next = { ...prev, [renameTarget.platform]: trimmedValue };
          try {
            window.localStorage.setItem(IM_GROUP_LABEL_STORAGE_KEY, JSON.stringify(next));
          } catch (error) {
            console.warn('[CoworkSessionList] Failed to persist IM group display name:', error);
          }
          return next;
        });
      } else {
        const nextTitle = `${ScheduledSessionTitlePrefix.LegacyScheduled} ${trimmedValue}`;
        await Promise.all(renameTarget.sessions.map((session) => runRename(session.id, nextTitle)));
      }
      closeRenameDialog();
    } catch (error) {
      console.error('[CoworkSessionList] Failed to rename session target:', error);
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('failedToSaveSettings') }));
    } finally {
      setIsRenamingSaving(false);
    }
  };

  const handleMenuDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeMenuTarget) return;
    setDeleteTarget(activeMenuTarget);
    closeMenu();
  };

  const runDelete = async (sessionId: string) => {
    const result = await Promise.resolve(onDeleteSession(sessionId) as unknown);
    if (result === false) {
      throw new Error('delete session returned false');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      if (deleteTarget.type === MenuTargetType.Session) {
        await runDelete(deleteTarget.session.id);
      } else {
        await Promise.all(deleteTarget.sessions.map((session) => runDelete(session.id)));
      }
      closeDeleteDialog();
    } catch (error) {
      console.error('[CoworkSessionList] Failed to delete session target:', error);
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('failedToSaveSettings') }));
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (!renameTarget) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameTarget]);

  useEffect(() => {
    if (!renameTarget) return undefined;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRenameDialog();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [renameTarget, isRenamingSaving]);

  useEffect(() => {
    if (!deleteTarget) return undefined;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDeleteDialog();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [deleteTarget, isDeleting]);

  const getDeleteDialogMessage = (): string => {
    if (!deleteTarget) return '';
    if (deleteTarget.type === MenuTargetType.Session) {
      return i18nService.t('confirmDeleteMessage');
    }
    return i18nService
      .t('coworkDeleteGroupConfirmMessage')
      .replace('{name}', deleteTarget.displayName)
      .replace('{count}', String(deleteTarget.sessions.length));
  };

  const renderItemMenu = (target: MenuTarget) => {
    const isOpen = activeMenuTarget?.key === target.key;
    return (
      <div className="relative shrink-0" data-cowork-session-menu-root="true">
        <button
          type="button"
          onClick={(event) => openMenu(event, target)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              openMenu(event, target);
            }
          }}
          className={`h-6 w-6 inline-flex items-center justify-center rounded-md dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-opacity ${
            isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          aria-label={i18nService.t('scheduledTasksListColMore')}
        >
          <EllipsisHorizontalIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
        {isOpen && (
          <div className="absolute right-0 top-full z-30 mt-0.5 w-36 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-xl py-1.5">
            <button
              type="button"
              onClick={handleMenuRename}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
            >
              <PencilSquareIcon className="h-4 w-4" />
              <span>{i18nService.t('renameConversation')}</span>
            </button>
            <button
              type="button"
              onClick={handleMenuDelete}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-500 dark:text-red-400 dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
            >
              <TrashIcon className="h-4 w-4" />
              <span>{i18nService.t('scheduledTasksDelete')}</span>
            </button>
          </div>
        )}
      </div>
    );
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
    <>
      <div className="space-y-3">
      {imGroups.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => {
              closeMenu();
              setImExpanded((prev) => !prev);
            }}
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
                const defaultLabel = `${i18nService.t('coworkMyPrefix')}${i18nService.t(group.labelKey)}`;
                const label = imGroupDisplayNames[group.platform]?.trim() || defaultLabel;
                const logo = IM_PLATFORM_LOGOS[group.platform];
                return (
                  <div
                    key={group.platform}
                    className={`group w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      isActive
                        ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                        : 'hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        onSelectSession(targetSession.id);
                      }}
                      className="min-w-0 flex-1 flex items-center gap-2 text-left"
                    >
                      <div className="flex h-6 w-6 items-center justify-center">
                        <img src={logo} alt={i18nService.t(group.platform)} className="h-5 w-5 object-contain rounded" />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium dark:text-claude-darkText text-claude-text">
                        {label}
                      </span>
                    </button>
                    {renderItemMenu({
                      type: MenuTargetType.ImGroup,
                      key: `im-group:${group.platform}`,
                      displayName: label,
                      platform: group.platform,
                      sessions: group.sessions,
                    })}
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
            onClick={() => {
              closeMenu();
              setScheduledExpanded((prev) => !prev);
            }}
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
                    <div className="group w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors">
                      <button
                        type="button"
                        onClick={() => {
                          closeMenu();
                          toggleTaskGroup(group.taskName);
                        }}
                        className="min-w-0 flex-1 flex items-center gap-2 text-left"
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
                      {renderItemMenu({
                        type: MenuTargetType.ScheduledGroup,
                        key: `scheduled-group:${group.taskName}`,
                        displayName: group.taskName,
                        taskName: group.taskName,
                        sessions: group.sessions,
                      })}
                    </div>

                    {isExpanded && (
                      <div className="ml-7 mt-1 border-l dark:border-claude-darkBorder border-claude-border pl-3 space-y-1">
                        {group.sessions.map((session) => {
                          const isActive = session.id === currentSessionId;
                          return (
                            <div
                              key={session.id}
                              className={`group w-full flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                                isActive
                                  ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                                  : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  closeMenu();
                                  onSelectSession(session.id);
                                }}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary truncate">
                                  {formatRunTime(session.updatedAt)}
                                </div>
                                <div className="mt-0.5 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                                  {i18nService.t(statusLabels[session.status])}
                                </div>
                              </button>
                              {renderItemMenu({
                                type: MenuTargetType.Session,
                                key: `scheduled-run:${session.id}`,
                                displayName: session.title,
                                session,
                              })}
                            </div>
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
          onClick={() => {
            closeMenu();
            setManualExpanded((prev) => !prev);
          }}
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
                  <div
                    key={session.id}
                    className={`group w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        isActive
                          ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                          : 'hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        onSelectSession(session.id);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="min-w-0 truncate text-sm font-medium dark:text-claude-darkText text-claude-text block">
                        {session.title}
                      </span>
                    </button>
                    {renderItemMenu({
                      type: MenuTargetType.Session,
                      key: `manual:${session.id}`,
                      displayName: session.title,
                      session,
                    })}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
      </div>

      {renameTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeRenameDialog}
        >
          <div
            className="relative w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto rounded-2xl dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeRenameDialog}
              className="absolute right-4 top-4 z-10 p-1 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              aria-label={i18nService.t('cancel')}
              disabled={isRenamingSaving}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
                {i18nService.t('coworkRenameTaskTitle')}
              </h2>
              <div>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleConfirmRename();
                    }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text dark:placeholder-claude-darkTextSecondary placeholder-claude-textSecondary border dark:border-claude-darkBorder border-claude-border focus:outline-none focus:ring-2 focus:ring-claude-accent"
                  placeholder={i18nService.t('coworkRenameTaskPlaceholder')}
                  disabled={isRenamingSaving}
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeRenameDialog}
                  className="px-3 py-1.5 text-xs rounded-lg border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors disabled:opacity-50"
                  disabled={isRenamingSaving}
                >
                  {i18nService.t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmRename()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-claude-accent text-white hover:bg-claude-accent/90 transition-colors disabled:opacity-50"
                  disabled={isRenamingSaving}
                >
                  {i18nService.t('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeDeleteDialog}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold dark:text-claude-darkText text-claude-text">
              {i18nService.t('confirmDelete')}
            </h2>
            <p className="mt-3 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {getDeleteDialogMessage()}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteDialog}
                className="px-4 py-2 text-sm font-medium rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors disabled:opacity-50"
                disabled={isDeleting}
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                disabled={isDeleting}
              >
                {i18nService.t('scheduledTasksDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CoworkSessionList;
