import { describe, expect, test } from 'vitest';
import { ScheduleKind } from './constants';
import { computeNextRunAtMs, shouldRunNow } from './ydCoworkSchedule';

describe('ydCoworkSchedule', () => {
  test('computes one-shot next run for future at schedule', () => {
    const now = Date.parse('2026-03-30T08:00:00+08:00');
    const schedule = {
      kind: ScheduleKind.At,
      at: '2026-03-30T09:00:00+08:00',
    } as const;
    expect(computeNextRunAtMs(schedule, now)).toBe(Date.parse(schedule.at));
  });

  test('returns null for past at schedule', () => {
    const now = Date.parse('2026-03-30T10:00:00+08:00');
    const schedule = {
      kind: ScheduleKind.At,
      at: '2026-03-30T09:00:00+08:00',
    } as const;
    expect(computeNextRunAtMs(schedule, now)).toBeNull();
  });

  test('computes interval next run using createdAt as anchor', () => {
    const createdAtMs = Date.parse('2026-03-30T08:00:00+08:00');
    const now = Date.parse('2026-03-30T08:16:00+08:00');
    const schedule = {
      kind: ScheduleKind.Every,
      everyMs: 5 * 60 * 1000,
    } as const;
    const next = computeNextRunAtMs(schedule, now, createdAtMs);
    expect(next).toBe(Date.parse('2026-03-30T08:20:00+08:00'));
  });

  test('computes cron next run', () => {
    const now = Date.parse('2026-03-30T08:30:00+08:00');
    const schedule = {
      kind: ScheduleKind.Cron,
      expr: '0 9 * * *',
      tz: 'Asia/Shanghai',
    } as const;
    const next = computeNextRunAtMs(schedule, now);
    expect(next).toBe(Date.parse('2026-03-30T09:00:00+08:00'));
  });

  test('shouldRunNow checks due state', () => {
    const now = 1000;
    expect(shouldRunNow(1000, now)).toBe(true);
    expect(shouldRunNow(999, now)).toBe(true);
    expect(shouldRunNow(1001, now)).toBe(false);
    expect(shouldRunNow(null, now)).toBe(false);
  });
});

