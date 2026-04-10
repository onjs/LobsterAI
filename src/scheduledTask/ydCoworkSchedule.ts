import { CronExpressionParser } from 'cron-parser';
import { ScheduleKind } from './constants';
import type { Schedule } from './types';

const MIN_EVERY_MS = 1_000;

function normalizeMs(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

function computeNextEveryRunAtMs(
  everyMs: number,
  anchorMs: number,
  nowMs: number,
): number | null {
  if (!Number.isFinite(everyMs) || everyMs < MIN_EVERY_MS) return null;
  if (!Number.isFinite(anchorMs)) return null;

  if (nowMs <= anchorMs) {
    return anchorMs;
  }
  const elapsed = nowMs - anchorMs;
  const steps = Math.ceil(elapsed / everyMs);
  return anchorMs + steps * everyMs;
}

function computeNextCronRunAtMs(expr: string, tz: string | undefined, nowMs: number): number | null {
  try {
    const iterator = CronExpressionParser.parse(expr, {
      currentDate: new Date(nowMs),
      ...(tz ? { tz } : {}),
    });
    const next = iterator.next();
    if (!next) return null;
    const nextMs = next.getTime();
    return Number.isFinite(nextMs) ? nextMs : null;
  } catch {
    return null;
  }
}

export function computeNextRunAtMs(
  schedule: Schedule,
  nowMs: number,
  createdAtMs?: number,
): number | null {
  if (schedule.kind === ScheduleKind.At) {
    const runAtMs = Date.parse(schedule.at);
    return Number.isFinite(runAtMs) && runAtMs > nowMs ? runAtMs : null;
  }

  if (schedule.kind === ScheduleKind.Every) {
    const everyMs = normalizeMs(schedule.everyMs);
    if (everyMs === null || everyMs < MIN_EVERY_MS) return null;
    const anchorMs = normalizeMs(schedule.anchorMs)
      ?? normalizeMs(createdAtMs)
      ?? nowMs;
    return computeNextEveryRunAtMs(everyMs, anchorMs, nowMs);
  }

  return computeNextCronRunAtMs(schedule.expr, schedule.tz, nowMs);
}

export function shouldRunNow(nextRunAtMs: number | null, nowMs: number): boolean {
  return typeof nextRunAtMs === 'number' && Number.isFinite(nextRunAtMs) && nextRunAtMs <= nowMs;
}

