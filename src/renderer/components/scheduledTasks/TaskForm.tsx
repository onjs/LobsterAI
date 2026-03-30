import React, { useEffect, useState } from 'react';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type {
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
} from '../../../scheduled-task/types';
import { formatScheduleLabel, type IntervalUnit, type PlanType, scheduleToPlanInfo } from './utils';

interface TaskFormProps {
  mode: 'create' | 'edit';
  task?: ScheduledTask;
  onCancel: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  description: string;
  planType: PlanType;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  monthDay: number;
  payloadText: string;
  notifyChannel: string;
  notifyTo: string;
}

function nowDefaults() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: 9,
    minute: 0,
    second: 0,
  };
}

const DEFAULT_FORM_STATE: FormState = {
  name: '',
  description: '',
  planType: 'daily',
  intervalValue: 1,
  intervalUnit: 'hours',
  ...nowDefaults(),
  weekday: 1,
  monthDay: 1,
  payloadText: '',
  notifyChannel: 'none',
  notifyTo: '',
};

const IM_CHANNEL_VALUES = new Set([
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
]);

function isIMChannel(channel: string): boolean {
  return IM_CHANNEL_VALUES.has(channel);
}

function createFormState(task?: ScheduledTask): FormState {
  if (!task) return { ...DEFAULT_FORM_STATE, ...nowDefaults() };

  const planInfo = scheduleToPlanInfo(task.schedule);
  return {
    name: task.name,
    description: task.description,
    planType: planInfo.planType,
    intervalValue: planInfo.intervalValue,
    intervalUnit: planInfo.intervalUnit,
    year: planInfo.year,
    month: planInfo.month,
    day: planInfo.day,
    hour: planInfo.hour,
    minute: planInfo.minute,
    second: planInfo.second,
    weekday: planInfo.weekday,
    monthDay: planInfo.monthDay,
    payloadText: task.payload.kind === 'systemEvent' ? task.payload.text : task.payload.message,
    notifyChannel: task.delivery.mode === 'announce' ? (task.delivery.channel || 'none') : 'none',
    notifyTo: task.delivery.to || '',
  };
}

function buildScheduleInput(form: FormState): ScheduledTaskInput['schedule'] {
  if (form.planType === 'once') {
    const date = new Date(form.year, form.month - 1, form.day, form.hour, form.minute, form.second);
    return { kind: 'at', at: date.toISOString() };
  }

  if (form.planType === 'interval') {
    const safeValue = Math.max(1, Math.floor(form.intervalValue || 1));
    const unitMs = form.intervalUnit === 'days'
      ? 86_400_000
      : form.intervalUnit === 'hours'
        ? 3_600_000
        : 60_000;
    return {
      kind: 'every',
      everyMs: safeValue * unitMs,
    };
  }

  const min = String(form.minute);
  const hr = String(form.hour);

  if (form.planType === 'hourly') {
    return { kind: 'cron', expr: `${min} * * * *` };
  }

  if (form.planType === 'daily') {
    return { kind: 'cron', expr: `${min} ${hr} * * *` };
  }

  if (form.planType === 'weekly') {
    return { kind: 'cron', expr: `${min} ${hr} * * ${form.weekday}` };
  }

  return { kind: 'cron', expr: `${min} ${hr} ${form.monthDay} * *` };
}

const WEEKDAY_KEYS = [
  'scheduledTasksFormWeekSun',
  'scheduledTasksFormWeekMon',
  'scheduledTasksFormWeekTue',
  'scheduledTasksFormWeekWed',
  'scheduledTasksFormWeekThu',
  'scheduledTasksFormWeekFri',
  'scheduledTasksFormWeekSat',
] as const;

const TaskForm: React.FC<TaskFormProps> = ({ mode, task, onCancel, onSaved }) => {
  const [form, setForm] = useState<FormState>(() => createFormState(task));
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => {
    if (!task) return false;
    return task.delivery.mode === 'announce' && !!task.delivery.channel;
  });
  const [channelOptions, setChannelOptions] = useState<ScheduledTaskChannelOption[]>(() => {
    const base: ScheduledTaskChannelOption[] = [];
    const savedChannel = task?.delivery.channel;
    if (savedChannel && isIMChannel(savedChannel) && !base.some((o) => o.value === savedChannel)) {
      base.push({ value: savedChannel, label: savedChannel });
    }
    return base;
  });
  const [conversations, setConversations] = useState<ScheduledTaskConversationOption[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAdvanced = form.planType === 'advanced';
  const showConversationSelector = notifyEnabled && isIMChannel(form.notifyChannel);

  useEffect(() => {
    setForm(createFormState(task));
    setNotifyEnabled(!!task && task.delivery.mode === 'announce' && !!task.delivery.channel);
  }, [task]);

  useEffect(() => {
    let cancelled = false;
    void scheduledTaskService.listChannels().then((channels) => {
      if (cancelled || channels.length === 0) return;
      setChannelOptions((current) => {
        const next = [...current];
        for (const channel of channels) {
          if (!next.some((item) => item.value === channel.value)) {
            next.push(channel);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showConversationSelector) {
      setConversations([]);
      return;
    }

    let cancelled = false;
    setConversationsLoading(true);
    void scheduledTaskService.listChannelConversations(form.notifyChannel).then((result) => {
      if (cancelled) return;
      setConversations(result);
      setConversationsLoading(false);

      if (result.length > 0) {
        setForm((current) => {
          if (current.notifyTo) return current;
          return { ...current, notifyTo: result[0].conversationId };
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [form.notifyChannel, showConversationSelector]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = i18nService.t('scheduledTasksFormValidationNameRequired');
    }
    if (!form.payloadText.trim()) {
      nextErrors.payloadText = i18nService.t('scheduledTasksFormValidationPromptRequired');
    }

    if (form.planType === 'once') {
      const runAt = new Date(form.year, form.month - 1, form.day, form.hour, form.minute, form.second);
      if (runAt.getTime() <= Date.now()) {
        nextErrors.schedule = i18nService.t('scheduledTasksFormValidationDatetimeFuture');
      }
    }

    if (form.planType === 'interval' && (!Number.isFinite(form.intervalValue) || form.intervalValue <= 0)) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationIntervalPositive');
    }

    const requiresClock = form.planType !== 'interval' && !isAdvanced;
    if (requiresClock && (form.hour < 0 || form.hour > 23 || form.minute < 0 || form.minute > 59)) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationTimeRequired');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const schedule = isAdvanced && task
        ? task.schedule
        : buildScheduleInput(form);

      const input: ScheduledTaskInput = {
        name: form.name.trim(),
        description: '',
        enabled: true,
        schedule,
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: form.payloadText.trim(),
        },
        delivery: !notifyEnabled || form.notifyChannel === 'none'
          ? { mode: 'none' }
          : {
              mode: 'announce',
              channel: form.notifyChannel,
              ...(form.notifyTo ? { to: form.notifyTo } : {}),
            },
      };

      if (mode === 'create') {
        await scheduledTaskService.createTask(input);
      } else if (task) {
        await scheduledTaskService.updateTaskById(task.id, input);
      }
      onSaved();
    } catch {
      // Service handles error state.
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-claude-border dark:border-claude-darkBorder dark:bg-claude-darkSurface bg-white px-4 py-3 text-base dark:text-claude-darkText text-claude-text placeholder:dark:text-claude-darkTextSecondary placeholder:text-claude-textSecondary focus:outline-none focus:ring-2 focus:ring-claude-accent/40';
  const compactInputClass = 'w-full rounded-xl border border-claude-border dark:border-claude-darkBorder dark:bg-claude-darkSurface bg-white px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text focus:outline-none focus:ring-2 focus:ring-claude-accent/40';
  const labelClass = 'block text-sm font-semibold dark:text-claude-darkText text-claude-text mb-2';
  const errorClass = 'text-xs text-red-500 mt-1';

  const timeValue = `${String(form.hour).padStart(2, '0')}:${String(form.minute).padStart(2, '0')}`;
  const minuteValue = String(form.minute).padStart(2, '0');
  const handleTimeChange = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      updateForm({ hour: h, minute: m });
    }
  };

  const handleNotifyToggle = (enabled: boolean) => {
    setNotifyEnabled(enabled);
    if (!enabled) {
      updateForm({ notifyChannel: 'none', notifyTo: '' });
    }
  };

  const renderScheduleRow = () => {
    if (isAdvanced) {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="rounded-xl bg-claude-surfaceHover/30 dark:bg-claude-darkSurfaceHover/30 p-4">
            <p className="text-sm dark:text-claude-darkText text-claude-text">
              {formatScheduleLabel(task!.schedule)}
            </p>
            <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary mt-1">
              {i18nService.t('scheduledTasksAdvancedSchedule')}
            </p>
          </div>
        </div>
      );
    }

    const planSelect = (
      <select
        value={form.planType}
        onChange={(event) => updateForm({ planType: event.target.value as PlanType })}
        className={`${compactInputClass} min-w-[140px]`}
      >
        <option value="once">{i18nService.t('scheduledTasksFormScheduleModeOnce')}</option>
        <option value="interval">{i18nService.t('scheduledTasksFormScheduleModeInterval')}</option>
        <option value="hourly">{i18nService.t('scheduledTasksFormScheduleModeHourly')}</option>
        <option value="daily">{i18nService.t('scheduledTasksFormScheduleModeDaily')}</option>
        <option value="weekly">{i18nService.t('scheduledTasksFormScheduleModeWeekly')}</option>
        <option value="monthly">{i18nService.t('scheduledTasksFormScheduleModeMonthly')}</option>
      </select>
    );

    if (form.planType === 'once') {
      const dateValue = `${form.year}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}`;
      const fullTimeValue = `${timeValue}:${String(form.second).padStart(2, '0')}`;
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {planSelect}
            <input
              type="date"
              value={dateValue}
              onChange={(e) => {
                const [y, mo, d] = e.target.value.split('-').map(Number);
                if (!Number.isNaN(y)) updateForm({ year: y, month: mo, day: d });
              }}
              className={`${compactInputClass} flex-1 min-w-[180px]`}
            />
            <input
              type="time"
              step="1"
              value={fullTimeValue}
              onChange={(e) => {
                const parts = e.target.value.split(':').map(Number);
                const patch: Partial<FormState> = {};
                if (!Number.isNaN(parts[0])) patch.hour = parts[0];
                if (!Number.isNaN(parts[1])) patch.minute = parts[1];
                if (parts.length > 2 && !Number.isNaN(parts[2])) patch.second = parts[2];
                updateForm(patch);
              }}
              className={`${compactInputClass} min-w-[140px]`}
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'interval') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {planSelect}
            <input
              type="number"
              min={1}
              value={form.intervalValue}
              onChange={(e) => updateForm({ intervalValue: Number(e.target.value) })}
              className={`${compactInputClass} w-[120px]`}
            />
            <select
              value={form.intervalUnit}
              onChange={(e) => updateForm({ intervalUnit: e.target.value as IntervalUnit })}
              className={`${compactInputClass} min-w-[130px]`}
            >
              <option value="minutes">{i18nService.t('scheduledTasksFormIntervalMinutes')}</option>
              <option value="hours">{i18nService.t('scheduledTasksFormIntervalHours')}</option>
              <option value="days">{i18nService.t('scheduledTasksFormIntervalDays')}</option>
            </select>
          </div>
        </div>
      );
    }

    if (form.planType === 'hourly') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {planSelect}
            <span className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('scheduledTasksFormHourlyAtMinute')}
            </span>
            <select
              value={minuteValue}
              onChange={(event) => updateForm({ minute: Number(event.target.value) })}
              className={`${compactInputClass} w-[110px]`}
            >
              {Array.from({ length: 60 }, (_, idx) => idx).map((m) => (
                <option key={m} value={String(m).padStart(2, '0')}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    if (form.planType === 'daily') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {planSelect}
            <input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={`${compactInputClass} min-w-[140px]`}
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'weekly') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {planSelect}
            <select
              value={form.weekday}
              onChange={(e) => updateForm({ weekday: Number(e.target.value) })}
              className={`${compactInputClass} min-w-[140px]`}
            >
              {WEEKDAY_KEYS.map((key, idx) => (
                <option key={idx} value={idx}>{i18nService.t(key)}</option>
              ))}
            </select>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={`${compactInputClass} min-w-[140px]`}
            />
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormPlanTime')}</label>
        <div className="flex flex-wrap items-center gap-3">
          {planSelect}
          <select
            value={form.monthDay}
            onChange={(e) => updateForm({ monthDay: Number(e.target.value) })}
            className={`${compactInputClass} min-w-[140px]`}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}{i18nService.t('scheduledTasksFormMonthDaySuffix')}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => handleTimeChange(e.target.value)}
            className={`${compactInputClass} min-w-[140px]`}
          />
        </div>
      </div>
    );
  };

  const renderNotifyRow = () => {
    return (
      <div className="rounded-xl border border-claude-border/70 dark:border-claude-darkBorder/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold dark:text-claude-darkText text-claude-text">
              {i18nService.t('scheduledTasksFormNotifyOptional')}
            </p>
            <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary mt-1">
              {i18nService.t('scheduledTasksFormNotifyHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleNotifyToggle(!notifyEnabled)}
            className={`h-7 min-w-[64px] rounded-full px-2 text-xs font-medium transition-colors ${
              notifyEnabled
                ? 'bg-claude-accent text-white'
                : 'bg-claude-surfaceHover dark:bg-claude-darkSurfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary'
            }`}
          >
            {notifyEnabled ? i18nService.t('scheduledTasksFormNotifyEnabled') : i18nService.t('scheduledTasksFormNotifyDisabled')}
          </button>
        </div>
        {notifyEnabled && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              value={form.notifyChannel}
              onChange={(event) => updateForm({ notifyChannel: event.target.value, notifyTo: '' })}
              className={`${compactInputClass} min-w-[180px]`}
            >
              <option value="none">{i18nService.t('scheduledTasksFormNotifyChannelNone')}</option>
              {channelOptions.map((channel) => {
                const unsupported = channel.value === 'openclaw-weixin' || channel.value === 'qqbot' || channel.value === 'xiaomifeng';
                return (
                  <option key={channel.value} value={channel.value} disabled={unsupported}>
                    {unsupported
                      ? `${channel.label} (${i18nService.t('scheduledTasksChannelUnsupported')})`
                      : channel.label}
                  </option>
                );
              })}
            </select>
            {showConversationSelector && (
              <select
                value={form.notifyTo}
                onChange={(event) => updateForm({ notifyTo: event.target.value })}
                disabled={conversationsLoading}
                className={`${compactInputClass} min-w-[260px]`}
              >
                {conversationsLoading ? (
                  <option value="">{i18nService.t('scheduledTasksFormNotifyConversationLoading')}</option>
                ) : conversations.length === 0 ? (
                  <option value="">{i18nService.t('scheduledTasksFormNotifyConversationNone')}</option>
                ) : (
                  conversations.map((conv) => (
                    <option key={conv.conversationId} value={conv.conversationId}>
                      {conv.conversationId}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        )}
        {!notifyEnabled && (
          <p className="mt-3 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('scheduledTasksFormNotifyNotRequired')}
          </p>
        )}
      </div>
    );
  };

  const formTitle = mode === 'create'
    ? i18nService.t('scheduledTasksFormCreateTitle')
    : i18nService.t('scheduledTasksFormUpdateTitle');
  const formSubtitle = mode === 'create'
    ? i18nService.t('scheduledTasksFormCreateSubtitle')
    : i18nService.t('scheduledTasksFormUpdateSubtitle');

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold dark:text-claude-darkText text-claude-text tracking-tight">
          {formTitle}
        </h2>
        <p className="text-base dark:text-claude-darkTextSecondary text-claude-textSecondary max-w-3xl">
          {formSubtitle}
        </p>
      </div>

      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormTaskName')}</label>
        <input
          type="text"
          value={form.name}
          onChange={(event) => updateForm({ name: event.target.value })}
          className={inputClass}
          placeholder={i18nService.t('scheduledTasksFormTaskNamePlaceholder')}
        />
        {errors.name && <p className={errorClass}>{errors.name}</p>}
      </div>

      {renderScheduleRow()}
      {errors.schedule && <p className={errorClass}>{errors.schedule}</p>}

      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormActionPromptLabel')}</label>
        <textarea
          value={form.payloadText}
          onChange={(event) => updateForm({ payloadText: event.target.value })}
          className={`${inputClass} h-36 resize-y`}
          placeholder={i18nService.t('scheduledTasksFormActionPromptPlaceholder')}
        />
        {errors.payloadText && <p className={errorClass}>{errors.payloadText}</p>}
      </div>

      {renderNotifyRow()}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-sm rounded-xl dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="px-5 py-2.5 text-sm font-semibold bg-claude-accent text-white rounded-xl hover:bg-claude-accentHover transition-colors disabled:opacity-50"
        >
          {submitting
            ? i18nService.t('saving')
            : mode === 'create'
              ? i18nService.t('scheduledTasksFormCreate')
              : i18nService.t('scheduledTasksFormUpdate')}
        </button>
      </div>
    </div>
  );
};

export default TaskForm;
