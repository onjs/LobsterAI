import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { EllipsisVerticalIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTask } from '../../../scheduled-task/types';
import { formatScheduleLabel } from './utils';

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

function formatScheduleMeta(task: ScheduledTask): { primary: string; secondary?: string } {
  if (task.schedule.kind === 'at') {
    const date = new Date(task.schedule.at);
    if (Number.isFinite(date.getTime())) {
      const language = i18nService.getLanguage();
      const time = language === 'zh'
        ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
        : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
      const day = language === 'zh'
        ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
        : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
      return { primary: time, secondary: day };
    }
  }

  const label = formatScheduleLabel(task.schedule).replace(/^[^·]*·\s*/, '').trim();
  return { primary: label };
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const taskContent = task.payload.kind === 'systemEvent'
    ? task.payload.text
    : task.payload.message;
  const scheduleMeta = formatScheduleMeta(task);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <div
      className="relative rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/50 bg-claude-surface/50 p-3 transition-colors hover:border-claude-accent/50 cursor-pointer"
      onClick={() => dispatch(selectTask(task.id))}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg dark:bg-claude-darkSurface bg-claude-surface flex items-center justify-center flex-shrink-0">
            <CalendarDaysIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          </div>
          <span className={`text-sm font-medium truncate ${task.enabled ? 'dark:text-claude-darkText text-claude-text' : 'dark:text-claude-darkTextSecondary text-claude-textSecondary'}`}>
            {task.name}
          </span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void scheduledTaskService.toggleTask(task.id, !task.enabled);
          }}
          className={`w-9 h-5 rounded-full flex items-center transition-colors cursor-pointer flex-shrink-0 ${
            task.enabled ? 'bg-claude-accent' : 'dark:bg-claude-darkSurfaceHover bg-claude-border'
          }`}
          title={task.enabled ? i18nService.t('enabled') : i18nService.t('disabled')}
        >
          <span
            className={`w-3.5 h-3.5 rounded-full bg-white shadow-md transform transition-transform ${
              task.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>

      {(taskContent || task.description) && (
        <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary line-clamp-2 mb-2">
          {taskContent || task.description}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2" ref={menuRef}>
        <div className="flex items-center gap-2 text-[10px] dark:text-claude-darkTextSecondary text-claude-textSecondary min-w-0">
          <span className="px-1.5 py-0.5 rounded bg-claude-accent/10 text-claude-accent font-medium truncate">
            {scheduleMeta.primary}
          </span>
          {scheduleMeta.secondary && (
            <>
              <span>·</span>
              <span className="truncate">{scheduleMeta.secondary}</span>
            </>
          )}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowMenu((value) => !value);
            }}
            className="p-1.5 rounded-md dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <EllipsisVerticalIcon className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 bottom-full mb-1 w-32 rounded-lg shadow-lg dark:bg-claude-darkSurface bg-white border dark:border-claude-darkBorder border-claude-border z-50 py-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowMenu(false);
                  void scheduledTaskService.runManually(task.id);
                }}
                disabled={Boolean(task.state.runningAtMs)}
                className="w-full text-left px-3 py-1.5 text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover disabled:opacity-50"
              >
                {i18nService.t('scheduledTasksRun')}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowMenu(false);
                  dispatch(selectTask(task.id));
                  dispatch(setViewMode('edit'));
                }}
                className="w-full text-left px-3 py-1.5 text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
              >
                {i18nService.t('scheduledTasksEdit')}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowMenu(false);
                  onRequestDelete(task.id, task.name);
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
              >
                {i18nService.t('scheduledTasksDelete')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
  onCreate: () => void;
}

const TaskList: React.FC<TaskListProps> = ({ onRequestDelete, onCreate }) => {
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const loading = useSelector((state: RootState) => state.scheduledTask.loading);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={onCreate}
        className="rounded-xl border-2 border-dashed dark:border-claude-darkBorder border-claude-border dark:text-claude-darkTextSecondary text-claude-textSecondary hover:border-claude-accent hover:text-claude-accent dark:hover:border-claude-accent dark:hover:text-claude-accent transition-colors flex items-center justify-center min-h-[120px] text-sm"
      >
        + {i18nService.t('scheduledTasksNewTask')}
      </button>
      {tasks.map((task) => (
        <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
      ))}
    </div>
  );
};

export default TaskList;
