import { basename } from 'node:path';

import { taskName, type ContinuoTask, type ContinuoWorkspaceDoc, type ExplorationAngle, type TaskError, type TaskStatus, type TaskTrigger, type Trajectory } from '@moonshot-ai/agent-core-v2';

import { ContinuoError } from './errors';

const BUSY = new Set<TaskStatus>(['queued', 'running', 'verifying']);

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '进行中',
  awaiting_user: '等你',
  verifying: '核对产物',
  completed: '已完成',
  needs_review: '还差一点',
  paused: '已暂停',
  failed: '没能完成',
  interrupted: '被打断',
};

export function isBusy(task: ContinuoTask): boolean {
  return BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval'));
}

export function isLiveBusy(task: ContinuoTask, attached: { has(taskId: string): boolean }): boolean {
  return attached.has(task.taskId) && isBusy(task);
}

export function assertIdle(doc: ContinuoWorkspaceDoc, line: Trajectory): void {
  const busy = doc.tasks.find((task) => line.taskIds.includes(task.taskId) && isBusy(task));
  if (busy !== undefined) throw new ContinuoError('invalid_state', `「${taskName(busy)}」还在进行，等它做完或停下后再操作。`);
}

export interface TurnError {
  readonly code?: string;
  readonly message?: string;
  readonly details?: { readonly statusCode?: unknown; readonly requestId?: unknown; readonly traceId?: unknown };
}

export const NO_MODEL = '请先用 Kimi 账号登录。';

export function isNoModel(message: string): boolean {
  return /model is required|is not configured/i.test(message);
}

export function taskErrorOf(error: TurnError | undefined, reason: string, at: string): TaskError {
  const details = error?.details ?? {};
  const noModel = isNoModel(error?.message ?? '');
  return {
    code: noModel ? 'model.not_configured' : error?.code ?? `turn.${reason}`,
    message: noModel ? NO_MODEL : (error?.message ?? reason).slice(0, 2000),
    status: typeof details.statusCode === 'number' ? details.statusCode : undefined,
    requestId: typeof details.requestId === 'string' ? details.requestId : undefined,
    traceId: typeof details.traceId === 'string' ? details.traceId : undefined,
    at,
  };
}

export function friendlyError(message: string): string {
  if (/usage limit|quota/i.test(message)) return 'Kimi 的用量额度用完了，额度恢复后重试';
  if (/rate limit|429|overloaded|503/i.test(message)) return '模型服务暂时忙不过来，稍后重试';
  if (/401|unauthori[sz]ed|not logged in|login/i.test(message)) return 'Kimi 账号需要重新登录，登录后重试';
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(message)) return '连不上模型服务，稍后重试';
  return message.slice(0, 160);
}

export function failureText(task: ContinuoTask): string | undefined {
  return task.error === undefined ? undefined : friendlyError(task.error.message);
}

export function asksUser(reply: string): boolean {
  const last = reply.trim().split(/\n\s*\n/).at(-1) ?? '';
  return /[？?]/.test(last);
}

export function explorationFailure(angles: readonly ExplorationAngle[]): string {
  const reasons = [...new Set(angles.map((angle) => angle.note).filter((note) => note !== undefined))];
  return `分头写的 ${angles.length} 个方案都没能完成${reasons.length === 0 ? '' : `：${reasons.join('；')}`}`;
}

export function phaseOf(tool: string, path: string | undefined): string {
  const file = path === undefined ? '' : ` ${basename(path)}`;
  switch (tool) {
    case 'Read':
    case 'ReadMediaFile': return `在读${file}`;
    case 'Write':
    case 'Edit': return `在写${file}`;
    case 'Grep':
    case 'Glob': return '在查找材料';
    case 'Bash': return '在运行命令';
    case 'WebSearch': return '在搜索网页';
    case 'FetchURL': return '在看网页';
    case 'Trajectory':
    case 'SubmitPlan': return '在整理方案';
    case 'ReportWorkspaceResult': return '在整理结果';
    default: return '进行中';
  }
}

export function readPath(display: unknown): string | undefined {
  if (typeof display !== 'object' || display === null) return undefined;
  const view = display as { kind?: string; operation?: string; path?: string };
  return view.kind === 'file_io' && view.operation === 'read' && typeof view.path === 'string' ? view.path : undefined;
}

export function writtenPath(display: unknown): string | undefined {
  if (typeof display !== 'object' || display === null) return undefined;
  const view = display as { kind?: string; operation?: string; path?: string };
  if (typeof view.path !== 'string') return undefined;
  if (view.kind === 'diff') return view.path;
  if (view.kind === 'file_io' && (view.operation === 'write' || view.operation === 'edit')) return view.path;
  return undefined;
}

type Pending = Exclude<NonNullable<ContinuoTask['pendingInteraction']>, 'none'>;

export interface Restart {
  readonly promptId: string;
  readonly trigger?: TaskTrigger;
  readonly phase?: string;
  readonly supplement?: string;
}

export function started(task: ContinuoTask, promptId: string): ContinuoTask {
  return { ...task, status: 'running', promptIds: [...task.promptIds, promptId] };
}

export function toRunning(task: ContinuoTask, restart: Restart): ContinuoTask {
  return {
    ...task,
    status: 'running',
    trigger: restart.trigger ?? task.trigger,
    phase: restart.phase,
    pendingInteraction: 'none',
    pauseRequested: false,
    promptIds: [...task.promptIds, restart.promptId],
    supplements: restart.supplement === undefined ? task.supplements : [...(task.supplements ?? []), restart.supplement],
    endedAt: undefined,
    verification: undefined,
    error: undefined,
  };
}

export function toAwaiting(task: ContinuoTask, pending: Pending, phase: string): ContinuoTask {
  return { ...task, status: 'awaiting_user', pendingInteraction: pending, phase };
}

export function toEnded(task: ContinuoTask, status: TaskStatus, at: string): ContinuoTask {
  return { ...task, status, phase: undefined, pendingInteraction: 'none', endedAt: at };
}

export function interruptedOnRestart(task: ContinuoTask, at: string): ContinuoTask {
  if (!isBusy(task)) return task;
  return { ...toEnded(task, 'interrupted', at), error: { code: 'turn.failed', message: '服务重启时这件事还在进行', at } };
}
