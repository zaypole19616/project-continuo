import { randomUUID } from 'node:crypto';

import { afterRun, nextRunAt, scheduleOf, type ContinuoTodo, type ContinuoWorkspaceDoc, type IContinuoStore, type Suggestion, type TodoCron, type TodoTiming } from '@moonshot-ai/agent-core-v2';

import { requireDoc } from './doc';
import { ContinuoError } from './errors';

export const TODO_TICK_MS = 30_000;
const WEEKDAYS = '日一二三四五六';

export class TodoRunner {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly tick: () => Promise<void>, private readonly intervalMs: number = TODO_TICK_MS) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, this.intervalMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export function scheduleLabel(schedule: TodoCron): string {
  const [minute = '0', hour = '0', day = '*', month = '*', weekday = '*'] = schedule.cron.split(' ');
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (!schedule.recurring) return `${month}月${day}日 ${time}`;
  return weekday === '*' ? `每天 ${time}` : `每周${WEEKDAYS[Number(weekday)] ?? weekday} ${time}`;
}

export async function addTodo(store: IContinuoStore, workspaceId: string, text: string, timing: TodoTiming | undefined): Promise<ContinuoWorkspaceDoc> {
  await requireDoc(store, workspaceId);
  const now = Date.now();
  const cron = timing === undefined ? undefined : scheduleOf(timing);
  if (timing !== undefined && cron === undefined) throw new ContinuoError('invalid_state', '这个时间设置不对。');
  if (timing?.kind === 'once' && Date.parse(timing.at) <= now) throw new ContinuoError('invalid_state', '这个时间已经过了。');
  const schedule = cron === undefined ? undefined : { ...cron, label: scheduleLabel(cron) };
  const todo: ContinuoTodo = { todoId: `todo_${randomUUID().slice(0, 8)}`, text: text.trim(), schedule, nextAt: schedule === undefined ? undefined : nextRunAt(schedule, now), createdAt: new Date(now).toISOString() };
  return store.update(workspaceId, (current) => ({ ...current, todos: [...(current.todos ?? []), todo] }));
}

export async function removeTodo(store: IContinuoStore, workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
  await requireDoc(store, workspaceId);
  return store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).filter((todo) => todo.todoId !== todoId) }));
}

export async function acceptTodo(store: IContinuoStore, workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
  const doc = await requireDoc(store, workspaceId);
  if (openTodo(doc, todoId).state !== 'suggested') return doc;
  return store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todoId ? { ...candidate, state: undefined } : candidate)) }));
}

export async function dismissTodo(store: IContinuoStore, workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
  openTodo(await requireDoc(store, workspaceId), todoId);
  return store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todoId ? { ...candidate, state: 'dismissed' as const } : candidate)) }));
}

export function openTodo(doc: ContinuoWorkspaceDoc, todoId: string): ContinuoTodo {
  const todo = (doc.todos ?? []).find((candidate) => candidate.todoId === todoId);
  if (todo === undefined) throw new ContinuoError('invalid_state', '这件待办找不到了。');
  if (todo.state === 'started' || todo.state === 'dismissed') throw new ContinuoError('invalid_state', todo.state === 'started' ? '这件事已经开始了。' : '这条建议已经划掉了。');
  return todo;
}

export function finishTodoRun(store: IContinuoStore, workspaceId: string, todo: ContinuoTodo, nowMs: number, taskId: string): Promise<ContinuoWorkspaceDoc> {
  const next = afterRun(todo, nowMs) ?? { ...todo, state: 'started' as const, taskId, nextAt: undefined };
  return store.update(workspaceId, (current) => ({
    ...current,
    todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todo.todoId ? next : candidate)),
  }));
}

export function suggestedTodos(doc: ContinuoWorkspaceDoc, fromTaskId: string, items: readonly Suggestion[], at: string): ContinuoTodo[] {
  const todos = doc.todos ?? [];
  if (todos.some((todo) => todo.fromTaskId === fromTaskId)) return todos as ContinuoTodo[];
  const known = new Set(todos.filter((todo) => todo.state === undefined || todo.state === 'suggested').map((todo) => todo.text));
  const added = items.filter((item) => !known.has(item.prompt)).map((item) => ({ todoId: `todo_${randomUUID().slice(0, 8)}`, text: item.prompt, title: item.title, reason: item.reason, fromTaskId, state: 'suggested' as const, createdAt: at }));
  return [...todos, ...added];
}
