import { computeNextCronRun, parseCronExpression } from '#/features/cron/internal/cron-expr';

import type { ContinuoTodo, ContinuoWorkspaceDoc, TodoSchedule } from './types';

export type TodoTiming =
  | { readonly kind: 'once'; readonly at: string }
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly day: number; readonly time: string };

export type TodoCron = Pick<TodoSchedule, 'cron' | 'recurring'>;

function clock(time: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : undefined;
}

export function scheduleOf(timing: TodoTiming): TodoCron | undefined {
  if (timing.kind === 'once') {
    const at = new Date(timing.at);
    if (Number.isNaN(at.getTime())) return undefined;
    return { cron: `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth() + 1} *`, recurring: false };
  }
  const time = clock(timing.time);
  if (time === undefined) return undefined;
  if (timing.kind === 'daily') return { cron: `${time.minute} ${time.hour} * * *`, recurring: true };
  if (!Number.isInteger(timing.day) || timing.day < 0 || timing.day > 6) return undefined;
  return { cron: `${time.minute} ${time.hour} * * ${timing.day}`, recurring: true };
}

export function nextRunAt(schedule: Pick<TodoSchedule, 'cron'>, fromMs: number): string | undefined {
  const next = computeNextCronRun(parseCronExpression(schedule.cron), fromMs);
  return next === null ? undefined : new Date(next).toISOString();
}

export function dueTodo(doc: ContinuoWorkspaceDoc, nowMs: number): ContinuoTodo | undefined {
  return (doc.todos ?? []).filter((todo) => todo.state === undefined && todo.nextAt !== undefined && Date.parse(todo.nextAt) <= nowMs).toSorted((a, b) => Date.parse(a.nextAt!) - Date.parse(b.nextAt!))[0];
}

export function afterRun(todo: ContinuoTodo, nowMs: number): ContinuoTodo | undefined {
  if (todo.schedule === undefined || !todo.schedule.recurring) return undefined;
  return { ...todo, lastRunAt: new Date(nowMs).toISOString(), nextAt: nextRunAt(todo.schedule, nowMs) };
}
