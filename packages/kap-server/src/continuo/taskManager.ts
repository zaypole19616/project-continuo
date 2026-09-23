import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

import {
  CONTINUO_INIT_PROFILE,
  CONTINUO_WORKER_PROFILE,
  EMPTY_USAGE,
  IAgentLifecycleService,
  IAgentLoopService,
  IAgentProfileService,
  IConfigService,
  IContinuoStore,
  IEventBus,
  ISessionActivityView,
  ISessionContext,
  ISessionManager,
  IWorkspaceService,
  PROMPT_CACHE_KEY_METADATA,
  WORK_LOG_DIR,
  buildTrajectoryExport,
  afterRun,
  choiceOn,
  currentTrajectory,
  dueTodo,
  getLiveSessionById,
  inheritedChoices,
  isExploring,
  lastTurnOf,
  lineById,
  lineRoot,
  localDay,
  localTime,
  logSlug,
  nextRunAt,
  openDecisionOf,
  planStatusOn,
  resumeSessionById,
  rootOfTask,
  scheduleOf,
  taskCategory,
  taskName,
  tasksThrough,
  trajectoryOfSession,
  type ContinuoPermissionMode,
  type ContinuoTask,
  type ContinuoTodo,
  type ContinuoWorkspaceDoc,
  type Decision,
  type DeliverableFeedback,
  type ExplorationAngle,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
  type TaskError,
  type TaskRound,
  type TaskStatus,
  type TaskTrigger,
  type TodoTiming,
  type Trajectory,
  type TrajectoryOrigin,
  type TrajectoryExport,
  type TrajectoryPlan,
} from '@moonshot-ai/agent-core-v2';
import { ulid } from 'ulid';

import { ensureMainAgent } from '../transport/mainAgent';
import { ContinuoError } from './errors';
import { createLineDir, linesSettled, snapshotDir } from './lines';
import { renderScanForPrompt, scanWorkspace } from './scan';

export { ContinuoError } from './errors';

interface Attachment {
  readonly dispose: () => void;
  readonly writes: Map<string, { path: string; turnId?: number }>;
  readonly sessionId: string;
  readonly reads: Set<string>;
  reply: string;
  prompt: string;
  turnIndex?: number;
}

interface Explorer {
  readonly dispose: () => void;
  readonly agent: IAgentScopeHandle;
  readonly decisionId: string;
  readonly key: string;
}

const INIT_STEP_BUDGET = 8;
const FORK_RETRIES = 25;
const FINAL_ANGLE = new Set<ExplorationAngle['status']>(['submitted', 'withdrawn', 'failed']);
const COPY_MAX_BYTES = 300 * 1024 * 1024;
const STALE_MS = 60_000;

function canCopyProject(doc: ContinuoWorkspaceDoc): boolean {
  if (doc.scan === undefined || doc.scan.truncated) return false;
  return doc.scan.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) <= COPY_MAX_BYTES;
}
const BUSY = new Set<TaskStatus>(['queued', 'running', 'verifying']);

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
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

interface TurnError {
  readonly code?: string;
  readonly message?: string;
  readonly details?: { readonly statusCode?: unknown; readonly requestId?: unknown; readonly traceId?: unknown };
}

function taskErrorOf(error: TurnError | undefined, reason: string, at: string): TaskError {
  const details = error?.details ?? {};
  return {
    code: error?.code ?? `turn.${reason}`,
    message: (error?.message ?? reason).slice(0, 2000),
    status: typeof details.statusCode === 'number' ? details.statusCode : undefined,
    requestId: typeof details.requestId === 'string' ? details.requestId : undefined,
    traceId: typeof details.traceId === 'string' ? details.traceId : undefined,
    at,
  };
}

function friendlyError(message: string): string {
  if (/usage limit|quota/i.test(message)) return 'Kimi 的用量额度用完了，额度恢复后重试';
  if (/rate limit|429|overloaded|503/i.test(message)) return '模型服务暂时忙不过来，稍后重试';
  if (/401|unauthori[sz]ed|not logged in|login/i.test(message)) return 'Kimi 账号需要重新登录，登录后重试';
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(message)) return '连不上模型服务，稍后重试';
  return message.slice(0, 160);
}

const NO_MODEL = '还没有可用的模型：先在终端运行 node apps/kimi-code/dist/main.mjs login 登录，再回来重试。';

function modelError(error: unknown): unknown {
  return error instanceof Error && /model is required/i.test(error.message) ? new ContinuoError('invalid_state', NO_MODEL) : error;
}

async function mainAgentOf(session: Parameters<typeof ensureMainAgent>[0]): Promise<Awaited<ReturnType<typeof ensureMainAgent>>> {
  try {
    return await mainAgentOf(session);
  } catch (error) {
    throw modelError(error);
  }
}

function phaseOf(tool: string, path: string | undefined): string {
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
    case 'Trajectory': return '在整理方案';
    case 'ReportWorkspaceResult': return '在整理结果';
    default: return '进行中';
  }
}

function readPath(display: unknown): string | undefined {
  if (typeof display !== 'object' || display === null) return undefined;
  const view = display as { kind?: string; operation?: string; path?: string };
  return view.kind === 'file_io' && view.operation === 'read' && typeof view.path === 'string' ? view.path : undefined;
}

function writtenPath(display: unknown): string | undefined {
  if (typeof display !== 'object' || display === null) return undefined;
  const view = display as { kind?: string; operation?: string; path?: string };
  if (typeof view.path !== 'string') return undefined;
  if (view.kind === 'diff') return view.path;
  if (view.kind === 'file_io' && (view.operation === 'write' || view.operation === 'edit')) return view.path;
  return undefined;
}

export class ContinuoTaskManager {
  private readonly attachments = new Map<string, Attachment>();
  private readonly explorers = new Map<string, Explorer>();
  private readonly requests = new Map<string, string>();
  private readonly creating = new Map<string, Promise<unknown>>();
  private readonly opening = new Map<string, Promise<ContinuoWorkspaceDoc>>();

  constructor(private readonly core: Scope) {}

  private get store(): IContinuoStore {
    return this.core.accessor.get(IContinuoStore);
  }

  async open(workspaceId: string, clientRequestId?: string): Promise<ContinuoWorkspaceDoc> {
    const inFlight = this.opening.get(workspaceId);
    if (inFlight !== undefined) return inFlight;
    const pending = this.openOnce(workspaceId, clientRequestId).finally(() => {
      this.opening.delete(workspaceId);
    });
    this.opening.set(workspaceId, pending);
    return pending;
  }

  private async openOnce(workspaceId: string, clientRequestId?: string): Promise<ContinuoWorkspaceDoc> {
    const workspace = await this.core.accessor.get(IWorkspaceService).get(workspaceId);
    if (workspace === undefined) throw new ContinuoError('workspace_not_found', '这个项目找不到了。');
    if (clientRequestId !== undefined && this.requests.get(`open:${workspaceId}`) === clientRequestId) {
      const existing = await this.store.load(workspaceId);
      if (existing !== undefined) return existing;
    }
    if (clientRequestId !== undefined) this.requests.set(`open:${workspaceId}`, clientRequestId);
    await this.store.ensure(workspaceId, workspace.root);
    let doc = await this.store.update(workspaceId, (current) => ({
      ...current,
      root: workspace.root,
      openCount: current.openCount + 1,
      tasks: current.tasks.map((task) => this.reconcileOnOpen(task)),
    }));
    for (const decision of doc.decisions) {
      if (isExploring(decision) && !this.attachments.has(decision.taskId)) await this.finishExploration(workspaceId, decision.decisionId, '被打断');
    }
    doc = await this.requireDoc(workspaceId);
    const initTaskId = doc.init.taskId;
    if (initTaskId !== undefined && (doc.init.status === 'completed' || doc.init.status === 'partial') && (doc.understanding?.suggestions ?? []).length > 0 && !(doc.todos ?? []).some((todo) => todo.fromTaskId === initTaskId)) {
      doc = await this.store.update(workspaceId, (current) => ({ ...current, todos: this.suggestedTodos(current, initTaskId, current.understanding?.suggestions ?? [], current.init.endedAt ?? new Date().toISOString()) }));
    }
    if (doc.init.status === 'pending') {
      doc = await this.startInit(doc);
    } else if (doc.init.status === 'running' && !this.isLive(doc.init.taskId, doc)) {
      doc = await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: current.understanding === undefined ? 'stopped' : 'completed', endedAt: new Date().toISOString() } }));
    }
    return doc;
  }

  async retryInit(workspaceId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    if (doc.init.status === 'running' && this.isLive(doc.init.taskId, doc)) return doc;
    return this.startInit(doc);
  }

  async snapshot(workspaceId: string): Promise<ContinuoWorkspaceDoc | undefined> {
    return this.store.load(workspaceId);
  }

  async exportTrajectories(workspaceId: string): Promise<TrajectoryExport> {
    const doc = await this.requireDoc(workspaceId);
    const feedback = new Map<string, DeliverableFeedback>();
    for (const task of doc.tasks) {
      const root = rootOfTask(doc, task);
      for (const item of task.report?.deliverables ?? []) {
        const info = await stat(isAbsolute(item.path) ? item.path : resolve(root, item.path)).catch(() => undefined);
        const endedAt = task.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(task.endedAt) + 1000;
        feedback.set(`${task.taskId}:${item.path}`, { exists: info !== undefined, modifiedAfter: info !== undefined && info.mtimeMs > endedAt });
      }
    }
    return buildTrajectoryExport(doc, feedback, new Date().toISOString());
  }

  async addTodo(workspaceId: string, text: string, timing: TodoTiming | undefined): Promise<ContinuoWorkspaceDoc> {
    await this.requireDoc(workspaceId);
    const now = Date.now();
    const schedule = timing === undefined ? undefined : scheduleOf(timing);
    if (timing !== undefined && schedule === undefined) throw new ContinuoError('invalid_state', '这个时间设置不对。');
    if (timing?.kind === 'once' && Date.parse(timing.at) <= now) throw new ContinuoError('invalid_state', '这个时间已经过了。');
    const todo: ContinuoTodo = { todoId: `todo_${randomUUID().slice(0, 8)}`, text: text.trim(), schedule, nextAt: schedule === undefined ? undefined : nextRunAt(schedule, now), createdAt: new Date(now).toISOString() };
    return this.store.update(workspaceId, (current) => ({ ...current, todos: [...(current.todos ?? []), todo] }));
  }

  async removeTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    await this.requireDoc(workspaceId);
    return this.store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).filter((todo) => todo.todoId !== todoId) }));
  }

  async startTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    const todo = this.openTodo(await this.requireDoc(workspaceId), todoId);
    const { task } = await this.createUserTask(workspaceId, todo.text);
    return this.finishTodoRun(workspaceId, todo, Date.now(), task.taskId);
  }

  async acceptTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    const todo = this.openTodo(await this.requireDoc(workspaceId), todoId);
    if (todo.state !== 'suggested') return this.requireDoc(workspaceId);
    return this.store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todoId ? { ...candidate, state: undefined } : candidate)) }));
  }

  async dismissTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    this.openTodo(await this.requireDoc(workspaceId), todoId);
    return this.store.update(workspaceId, (current) => ({ ...current, todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todoId ? { ...candidate, state: 'dismissed' as const } : candidate)) }));
  }

  private openTodo(doc: ContinuoWorkspaceDoc, todoId: string): ContinuoTodo {
    const todo = (doc.todos ?? []).find((candidate) => candidate.todoId === todoId);
    if (todo === undefined) throw new ContinuoError('invalid_state', '这件待办找不到了。');
    if (todo.state === 'started' || todo.state === 'dismissed') throw new ContinuoError('invalid_state', todo.state === 'started' ? '这件事已经开始了。' : '这条建议已经划掉了。');
    return todo;
  }

  async runDueTodos(): Promise<void> {
    const now = Date.now();
    for (const workspaceId of await this.store.workspaceIds()) {
      const stored = await this.store.load(workspaceId).catch(() => undefined);
      if (stored === undefined || dueTodo(stored, now) === undefined) continue;
      const doc = await this.store.update(workspaceId, (current) => ({ ...current, tasks: current.tasks.map((task) => (now - Date.parse(task.updatedAt) > STALE_MS ? this.reconcileOnOpen(task) : task)) }));
      const todo = dueTodo(doc, now);
      if (todo === undefined || this.projectBusy(doc)) continue;
      try {
        const { task } = await this.createUserTask(workspaceId, todo.text);
        await this.finishTodoRun(workspaceId, todo, now, task.taskId);
      } catch {
        continue;
      }
    }
  }

  private projectBusy(doc: ContinuoWorkspaceDoc): boolean {
    return (doc.init.status === 'running' && this.isLive(doc.init.taskId, doc)) || doc.tasks.some((task) => task.kind === 'user' && this.attachments.has(task.taskId) && (BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval'))));
  }

  private finishTodoRun(workspaceId: string, todo: ContinuoTodo, nowMs: number, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const next = afterRun(todo, nowMs) ?? { ...todo, state: 'started' as const, taskId, nextAt: undefined };
    return this.store.update(workspaceId, (current) => ({
      ...current,
      todos: (current.todos ?? []).map((candidate) => (candidate.todoId === todo.todoId ? next : candidate)),
    }));
  }

  private suggestedTodos(doc: ContinuoWorkspaceDoc, fromTaskId: string, items: ReadonlyArray<{ title: string; reason: string; prompt: string }>, at: string): ContinuoTodo[] {
    const todos = doc.todos ?? [];
    if (todos.some((todo) => todo.fromTaskId === fromTaskId)) return todos as ContinuoTodo[];
    const known = new Set(todos.filter((todo) => todo.state === undefined || todo.state === 'suggested').map((todo) => todo.text));
    const added = items.filter((item) => !known.has(item.prompt)).map((item) => ({ todoId: `todo_${randomUUID().slice(0, 8)}`, text: item.prompt, title: item.title, reason: item.reason, fromTaskId, state: 'suggested' as const, createdAt: at }));
    return [...todos, ...added];
  }

  createUserTask(workspaceId: string, text: string, clientRequestId?: string): Promise<{ doc: ContinuoWorkspaceDoc; task: ContinuoTask }> {
    const previous = this.creating.get(workspaceId) ?? Promise.resolve();
    const run = previous.then(() => this.createUserTaskNow(workspaceId, text, clientRequestId));
    this.creating.set(workspaceId, run.catch(() => undefined));
    return run;
  }

  private async createUserTaskNow(workspaceId: string, text: string, clientRequestId?: string): Promise<{ doc: ContinuoWorkspaceDoc; task: ContinuoTask }> {
    const doc = await this.requireDoc(workspaceId);
    if (clientRequestId !== undefined) {
      const known = this.requests.get(`task:${workspaceId}:${clientRequestId}`);
      const existing = known === undefined ? undefined : doc.tasks.find((task) => task.taskId === known);
      if (existing !== undefined) return { doc, task: existing };
    }
    const running = doc.tasks.find((task) => task.kind === 'user' && (BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval'))));
    if (running !== undefined) {
      throw new ContinuoError('invalid_state', `「${taskName(running)}」还没结束，等它做完或停下后再交代新的事。`);
    }
    const line = currentTrajectory(doc);
    const session = line === undefined
      ? await this.newSession(workspaceId, doc.root, CONTINUO_WORKER_PROFILE)
      : await resumeSessionById(this.core.accessor, line.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', '这条轨迹的对话记录找不到了。');
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    const sessionId = session.accessor.get(ISessionContext).sessionId;
    const taskId = `task_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const task: ContinuoTask = {
      taskId,
      kind: 'user',
      title: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      trigger: 'user',
      sessionId,
      promptIds: [],
      status: 'queued',
      pauseRequested: false,
      contextRevision: doc.revision,
      usage: EMPTY_USAGE,
      createdAt: now,
      updatedAt: now,
    };
    if (clientRequestId !== undefined) this.requests.set(`task:${workspaceId}:${clientRequestId}`, taskId);
    await this.store.update(workspaceId, (current) => ({
      ...current,
      tasks: [...current.tasks, task],
      todos: (current.todos ?? []).map((todo) => (todo.schedule === undefined && todo.text === text && (todo.state === undefined || todo.state === 'suggested') ? { ...todo, state: 'started' as const, taskId } : todo)),
      trajectories: line === undefined
        ? [{ trajectoryId: `trj_${randomUUID().slice(0, 8)}`, label: '', sessionId, status: 'current', taskIds: [taskId], choices: [], turnCount: 0, createdAt: now }]
        : current.trajectories.map((candidate) => (candidate.trajectoryId === line.trajectoryId ? { ...candidate, taskIds: [...candidate.taskIds, taskId] } : candidate)),
    }));
    this.attach(workspaceId, taskId, session, agent);
    const promptId = await this.sendTurn(workspaceId, taskId, agent, text);
    const updated = await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [...current.promptIds, promptId] }));
    return { doc: updated, task: updated.tasks.find((candidate) => candidate.taskId === taskId)! };
  }

  async pause(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.status !== 'running' && task.status !== 'awaiting_user' && task.status !== 'queued') return doc;
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, pauseRequested: true }));
    const exploring = doc.decisions.find((decision) => decision.taskId === taskId && isExploring(decision));
    if (exploring !== undefined) {
      await this.finishExploration(workspaceId, exploring.decisionId, '已停止');
      return this.requireDoc(workspaceId);
    }
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session !== undefined) {
      const agent = await mainAgentOf(session);
      const loop = agent.accessor.get(IAgentLoopService);
      const cancelled = loop.cancel(undefined, 'paused by user');
      if (!cancelled) {
        return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'paused', endedAt: new Date().toISOString() }));
      }
      return this.requireDoc(workspaceId);
    }
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'paused', endedAt: new Date().toISOString() }));
  }

  async resume(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.status !== 'paused' && task.status !== 'interrupted' && task.status !== 'needs_review' && task.status !== 'failed') {
      throw new ContinuoError('invalid_state', '这件事现在不能继续。');
    }
    const resumeLine = trajectoryOfSession(doc, task.sessionId);
    if (resumeLine !== undefined) this.assertIdle(doc, resumeLine);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', '这件事的对话记录找不到了。');
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    this.attach(workspaceId, taskId, session, agent);
    const reason = task.status === 'needs_review'
      ? `上次核对时还差一点${(task.report?.unresolved ?? []).length > 0 ? `：${(task.report?.unresolved ?? []).join('；')}` : ''}。`
      : task.status === 'failed'
        ? `上次没做完${task.lastError === undefined ? '' : `（${task.lastError.slice(0, 120)}）`}。`
        : '上次停在了半路。';
    const promptId = await this.sendTurn(workspaceId, taskId, agent, `继续「${taskName(task)}」。${reason}先看看项目里已经有什么，别重做做完的部分，把剩下的做完。`, '继续这件事');
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pauseRequested: false, trigger: 'resume' as TaskTrigger, promptIds: [...current.promptIds, promptId], endedAt: undefined, verification: undefined, lastError: undefined, error: undefined }));
  }

  async reply(workspaceId: string, taskId: string, text: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.kind !== 'user') throw new ContinuoError('invalid_state', '这件事不接受回复。');
    if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply' && task.pendingInteraction !== 'choice')) {
      throw new ContinuoError('invalid_state', '这件事正在等你回答或批准，先处理那张卡片。');
    }
    const line = trajectoryOfSession(doc, task.sessionId);
    if (line !== undefined) this.assertIdle(doc, line);
    const open = line === undefined || task.pendingInteraction !== 'choice' ? undefined : openDecisionOf(doc, line, taskId);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', '这件事的对话记录找不到了。');
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    this.attach(workspaceId, taskId, session, agent);
    if (line !== undefined && open !== undefined) {
      const at = new Date().toISOString();
      await this.store.update(workspaceId, (current) => ({
        ...current,
        trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === line.trajectoryId ? { ...candidate, choices: [...candidate.choices, { decisionId: open.decisionId, text, turnIndex: candidate.turnCount, at }] } : candidate)),
      }));
    }
    const promptId = await this.sendTurn(workspaceId, taskId, agent, text);
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, trigger: 'reply' as TaskTrigger, promptIds: [...current.promptIds, promptId], supplements: [...(current.supplements ?? []), text], endedAt: undefined, verification: undefined, lastError: undefined, error: undefined }));
  }

  async choosePlan(workspaceId: string, decisionId: string, planId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const plan = this.requirePlan(decision, planId);
    if (plan.abandoned !== undefined) throw new ContinuoError('invalid_state', '这个方案已经放弃了。');
    const line = this.requireCurrent(doc);
    this.assertIdle(doc, line);
    const status = planStatusOn(doc, line, decision, plan);
    if (status.kind === 'current') return doc;
    if (status.kind === 'elsewhere') return this.activateTrajectory(workspaceId, status.trajectory.trajectoryId);
    const home = doc.trajectories.find((candidate) => candidate.trajectoryId === decision.trajectoryId);
    if (home === undefined) throw new ContinuoError('invalid_state', '这个决策点所在的轨迹找不到了。');
    const at = new Date().toISOString();
    const roundPrompt = `采用「${plan.title}」`;
    if (home.trajectoryId === line.trajectoryId && choiceOn(home, decisionId) === undefined) {
      const task = this.requireTask(doc, decision.taskId);
      const session = await resumeSessionById(this.core.accessor, task.sessionId);
      if (session === undefined) throw new ContinuoError('invalid_state', '这件事的对话记录找不到了。');
      const agent = await mainAgentOf(session);
      await this.prepareWorker(agent, workspaceId);
      this.attach(workspaceId, task.taskId, session, agent);
      await this.store.update(workspaceId, (current) => ({
        ...current,
        trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === home.trajectoryId ? { ...candidate, choices: [...candidate.choices, { decisionId, planId, turnIndex: candidate.turnCount, at }] } : candidate)),
      }));
      const promptId = await this.sendTurn(workspaceId, task.taskId, agent, planPrompt(plan), roundPrompt);
      await this.patchTask(workspaceId, task.taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, trigger: 'plan' as TaskTrigger, promptIds: [...current.promptIds, promptId], endedAt: undefined }));
      await this.writePlanFiles(workspaceId, task.taskId);
      return this.requireDoc(workspaceId);
    }
    const origin = this.requireTask(doc, decision.taskId);
    const label = `方案${plan.planId}`;
    await linesSettled(doc.root);
    const forked = await this.forkLine(workspaceId, home, decision.turnIndex, label, {
      taskIds: tasksThrough(doc, home, (candidate) => candidate.taskId !== decision.taskId),
      choices: [...inheritedChoices(home, decision.turnIndex), { decisionId, planId, turnIndex: decision.turnIndex + 1, at }],
      origin: { fromTrajectoryId: home.trajectoryId, turnIndex: decision.turnIndex, decisionId, planId },
    }, this.requireDecision(await this.requireDoc(workspaceId), decisionId).snapshot);
    const taskId = `task_${randomUUID().slice(0, 8)}`;
    const branchTask: ContinuoTask = {
      taskId,
      kind: 'user',
      title: origin.title,
      name: origin.name,
      category: origin.category,
      branch: { decisionId, planId, label },
      trigger: 'plan',
      sessionId: forked.trajectory.sessionId,
      promptIds: [],
      status: 'queued',
      pauseRequested: false,
      contextRevision: doc.revision,
      usage: EMPTY_USAGE,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      tasks: [...current.tasks, branchTask],
      trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === forked.trajectory.trajectoryId ? { ...candidate, taskIds: [...candidate.taskIds, taskId] } : candidate)),
    }));
    this.attach(workspaceId, taskId, forked.session, forked.agent);
    const promptId = await this.sendTurn(workspaceId, taskId, forked.agent, planPrompt(plan), roundPrompt);
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [promptId] }));
    await this.writePlanFiles(workspaceId, decision.taskId);
    return this.requireDoc(workspaceId);
  }

  async expandPlans(workspaceId: string, decisionId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const line = this.requireCurrent(doc);
    this.assertIdle(doc, line);
    if (decision.trajectoryId !== line.trajectoryId || choiceOn(line, decisionId) !== undefined) {
      throw new ContinuoError('invalid_state', '只有还没选定的决策点才能再要方案。');
    }
    if (decision.exhausted !== undefined) throw new ContinuoError('invalid_state', '这个决策点已经没有明显不同的方案了。');
    const task = this.requireTask(doc, decision.taskId);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', '这件事的对话记录找不到了。');
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    this.attach(workspaceId, task.taskId, session, agent);
    const promptId = await this.sendTurn(workspaceId, task.taskId, agent, '再给几个方案，只要和已有方案思路明显不同的。如果已经没有真正不同的方向，就告诉我为什么，以及需要我来定的那个问题。', '更多方案');
    return this.patchTask(workspaceId, task.taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, promptIds: [...current.promptIds, promptId], endedAt: undefined }));
  }

  async abandonPlan(workspaceId: string, decisionId: string, planId: string, reason: string | undefined): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const plan = this.requirePlan(decision, planId);
    const line = this.requireCurrent(doc);
    if (choiceOn(line, decisionId)?.planId === planId) throw new ContinuoError('invalid_state', '先换到别的方案，再放弃这一个。');
    const at = new Date().toISOString();
    const note = reason === undefined || reason.trim() === '' ? undefined : reason.trim().slice(0, 300);
    await this.store.update(workspaceId, (current) => ({
      ...current,
      decisions: current.decisions.map((candidate) => (candidate.decisionId !== decisionId ? candidate : { ...candidate, plans: candidate.plans.map((item) => (item.planId === plan.planId ? { ...item, abandoned: { reason: note, at } } : item)) })),
      trajectories: current.trajectories.map((candidate) => (candidate.status !== 'current' && choiceOn(candidate, decisionId)?.planId === planId ? { ...candidate, status: 'abandoned', abandonReason: note } : candidate)),
    }));
    await this.writePlanFiles(workspaceId, decision.taskId);
    await this.writeWorkLog(workspaceId, decision.taskId);
    return this.requireDoc(workspaceId);
  }

  async activateTrajectory(workspaceId: string, trajectoryId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const target = doc.trajectories.find((candidate) => candidate.trajectoryId === trajectoryId);
    if (target === undefined) throw new ContinuoError('invalid_state', '这条轨迹找不到了。');
    if (target.status === 'abandoned') throw new ContinuoError('invalid_state', '这条轨迹已经放弃了。');
    if (target.status === 'current') return doc;
    this.assertIdle(doc, this.requireCurrent(doc));
    return this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === trajectoryId ? { ...candidate, status: 'current' } : candidate.status === 'current' ? { ...candidate, status: 'alternative' } : candidate)),
    }));
  }

  async forkAfterTask(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const line = this.requireCurrent(doc);
    this.assertIdle(doc, line);
    const task = this.requireTask(doc, taskId);
    if (!line.taskIds.includes(taskId)) throw new ContinuoError('invalid_state', '这件事不在当前轨迹上。');
    const turnIndex = lastTurnOf(task);
    if (turnIndex === undefined) throw new ContinuoError('invalid_state', '这件事还没有完成的一轮，不能从这里接着做。');
    const kept = line.taskIds.slice(0, line.taskIds.indexOf(taskId) + 1);
    await linesSettled(doc.root);
    const latest = line.taskIds.at(-1) === taskId;
    const commit = this.requireTask(await this.requireDoc(workspaceId), taskId).snapshot
      ?? (latest && canCopyProject(doc) ? await snapshotDir(doc.root, lineRoot(doc, line), `task/${taskId}`) : undefined);
    await this.forkLine(workspaceId, line, turnIndex, `从「${taskName(task)}」继续`, {
      taskIds: kept,
      choices: inheritedChoices(line, turnIndex),
      origin: { fromTrajectoryId: line.trajectoryId, turnIndex, afterTaskId: taskId },
    }, commit);
    return this.requireDoc(workspaceId);
  }

  private async forkLine(workspaceId: string, parent: Trajectory, turnIndex: number, label: string, shape: { taskIds: readonly string[]; choices: Trajectory['choices']; origin: TrajectoryOrigin }, commit: string | undefined): Promise<{ trajectory: Trajectory; session: ISessionScopeHandle; agent: IAgentScopeHandle }> {
    const meta = await this.forkWhenIdle(await this.requireDoc(workspaceId), parent.sessionId, turnIndex, `Continuo · ${label}`);
    const session = await resumeSessionById(this.core.accessor, meta.id);
    if (session === undefined) throw new ContinuoError('invalid_state', '复制出的对话没能打开');
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    const trajectoryId = `trj_${randomUUID().slice(0, 8)}`;
    const root = (await this.requireDoc(workspaceId)).root;
    const workDir = commit === undefined ? undefined : await createLineDir(root, commit, trajectoryId);
    const trajectory: Trajectory = { trajectoryId, label, sessionId: meta.id, status: 'current', taskIds: shape.taskIds, choices: shape.choices, turnCount: turnIndex + 1, origin: shape.origin, workDir, createdAt: new Date().toISOString() };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: [...current.trajectories.map((candidate) => (candidate.status === 'current' ? { ...candidate, status: 'alternative' as const } : candidate)), trajectory],
    }));
    return { trajectory, session, agent };
  }

  private async forkWhenIdle(doc: ContinuoWorkspaceDoc, sourceSessionId: string, turnIndex: number, title: string): Promise<{ id: string }> {
    const cacheKey = doc.trajectories.find((line) => line.origin === undefined)?.sessionId ?? sourceSessionId;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.core.accessor.get(ISessionManager).fork({ sourceSessionId, turnIndex, title, metadata: { [PROMPT_CACHE_KEY_METADATA]: cacheKey } });
      } catch (error) {
        if (attempt >= FORK_RETRIES || !String((error as Error).message).includes('cannot be forked')) throw error;
        await new Promise((done) => { setTimeout(done, 200); });
      }
    }
  }

  private assertIdle(doc: ContinuoWorkspaceDoc, line: Trajectory): void {
    const busy = doc.tasks.find((task) => line.taskIds.includes(task.taskId) && (BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval'))));
    if (busy !== undefined) throw new ContinuoError('invalid_state', `「${taskName(busy)}」还在进行，等它做完或停下后再操作。`);
  }

  private requireCurrent(doc: ContinuoWorkspaceDoc): Trajectory {
    const line = currentTrajectory(doc);
    if (line === undefined) throw new ContinuoError('invalid_state', '这个项目还没有轨迹。');
    return line;
  }

  private requireDecision(doc: ContinuoWorkspaceDoc, decisionId: string): Decision {
    const decision = doc.decisions.find((candidate) => candidate.decisionId === decisionId);
    if (decision === undefined) throw new ContinuoError('invalid_state', '这个决策点找不到了。');
    return decision;
  }

  private requirePlan(decision: Decision, planId: string): TrajectoryPlan {
    const plan = decision.plans.find((candidate) => candidate.planId === planId);
    if (plan === undefined) throw new ContinuoError('invalid_state', '这个方案找不到了。');
    return plan;
  }


  private async writePlanFiles(workspaceId: string, taskId: string): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) return;
    for (const decision of doc.decisions.filter((candidate) => candidate.taskId === taskId)) {
      const holders = doc.trajectories.filter((line) => line.status !== 'abandoned' && (line.trajectoryId === decision.trajectoryId || line.taskIds.includes(taskId) || choiceOn(line, decision.decisionId) !== undefined));
      for (const root of new Set(holders.map((line) => lineRoot(doc, line)))) {
        try {
          await mkdir(resolve(root, WORK_LOG_DIR), { recursive: true });
          for (const plan of decision.plans) await writeFile(resolve(root, plan.path), renderPlan(doc, task, decision, plan), 'utf8');
        } catch {
          continue;
        }
      }
    }
  }

  private reconcileOnOpen(task: ContinuoTask): ContinuoTask {
    const inFlight = task.status === 'running' || task.status === 'verifying' || task.status === 'queued' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply' && task.pendingInteraction !== 'choice');
    if (inFlight && !this.attachments.has(task.taskId)) {
      return { ...task, status: 'interrupted', lastError: '服务重启时这件事还在进行', updatedAt: new Date().toISOString(), endedAt: new Date().toISOString() };
    }
    return task;
  }

  private isLive(taskId: string | undefined, doc: ContinuoWorkspaceDoc): boolean {
    if (taskId === undefined) return false;
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    return task !== undefined && this.attachments.has(taskId) && getLiveSessionById(this.core.accessor, task.sessionId) !== undefined;
  }

  private async newSession(workspaceId: string, workDir: string, profile: string) {
    try {
      return await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir, mainAgentBinding: { profile } });
    } catch (error) {
      throw modelError(error);
    }
  }

  private async openInitAgent(workspaceId: string, root: string) {
    const session = await this.newSession(workspaceId, root, CONTINUO_INIT_PROFILE);
    return { session, agent: await mainAgentOf(session) };
  }

  private async startInit(doc: ContinuoWorkspaceDoc): Promise<ContinuoWorkspaceDoc> {
    const workspaceId = doc.workspaceId;
    const scan = await scanWorkspace(doc.root);
    const now = new Date().toISOString();
    const taskId = `task_${randomUUID().slice(0, 8)}`;
    if (scan.entries.length === 0) {
      return this.store.update(workspaceId, (current) => ({
        ...current,
        scan,
        init: { status: 'pending', startedAt: now, endedAt: now },
        understanding: { text: '这个文件夹是空的。放进材料后再打开，会先了解一遍；也可以直接交代第一件事。', sourceRefs: [], updatedAt: now },
      }));
    }
    const opened = await this.openInitAgent(workspaceId, doc.root).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (opened instanceof Error) {
      const error = { code: opened.message === NO_MODEL ? 'model.not_configured' : 'turn.failed', message: opened.message, at: now };
      const failed: ContinuoTask = { taskId, kind: 'init', title: '了解这个文件夹', trigger: 'first_open', sessionId: '', promptIds: [], status: 'failed', pauseRequested: false, contextRevision: doc.revision, usage: EMPTY_USAGE, createdAt: now, updatedAt: now, endedAt: now, error, lastError: opened.message };
      return this.store.update(workspaceId, (current) => ({ ...current, scan, init: { status: 'failed', taskId, startedAt: now, endedAt: now }, tasks: [...current.tasks, failed] }));
    }
    const { session, agent } = opened;
    agent.accessor.get(IAgentLifecycleService).broadcastPermissionMode('auto');
    const sessionId = session.accessor.get(ISessionContext).sessionId;
    const task: ContinuoTask = {
      taskId,
      kind: 'init',
      title: '了解这个文件夹',
      trigger: 'first_open',
      sessionId,
      promptIds: [],
      status: 'queued',
      pauseRequested: false,
      contextRevision: doc.revision,
      usage: EMPTY_USAGE,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      scan,
      init: { status: 'running', taskId, startedAt: now },
      tasks: [...current.tasks, task],
    }));
    this.attach(workspaceId, taskId, session, agent);
    const prompt = [
      'A user just opened this folder in Continuo. Understand how it is organized and record your understanding with the WorkspaceContext tool, following your instructions.',
      'Write the understanding and every entry in the language the workspace documents themselves use (for example Chinese when the guide file is in Chinese).',
      `Order: guide files first, then judge from the structure below; open other materials only if the guides and the structure are not enough. Read at most 8 files in total, stop after about ${INIT_STEP_BUDGET} steps or as soon as the purpose, key materials and conventions are clear, and say clearly which parts you did not read.`,
      '',
      renderScanForPrompt(scan, doc.root),
    ].join('\n');
    const promptId = this.submitPrompt(agent, taskId, prompt, '');
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [promptId] }));
  }

  private async sendTurn(workspaceId: string, taskId: string, agent: IAgentScopeHandle, text: string, roundPrompt: string = text): Promise<string> {
    const task = this.requireTask(await this.requireDoc(workspaceId), taskId);
    let turnIndex: number | undefined;
    await this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: current.trajectories.map((candidate) => {
        if (candidate.sessionId !== task.sessionId) return candidate;
        turnIndex = candidate.turnCount;
        return { ...candidate, turnCount: candidate.turnCount + 1 };
      }),
    }));
    const attachment = this.attachments.get(taskId);
    if (attachment !== undefined) attachment.turnIndex = turnIndex;
    return this.submitPrompt(agent, taskId, text, roundPrompt);
  }

  private submitPrompt(agent: IAgentScopeHandle, taskId: string, text: string, roundPrompt: string = text): string {
    const attachment = this.attachments.get(taskId);
    if (attachment !== undefined) attachment.prompt = roundPrompt;
    const loop = agent.accessor.get(IAgentLoopService);
    const promptId = `msg_${ulid()}`;
    loop.submit({
      message: { role: 'user', content: [{ type: 'text', text }] },
      meta: { promptId, origin: { kind: 'user' }, tracked: true },
    } as Parameters<IAgentLoopService['submit']>[0]);
    return promptId;
  }

  async setPermissionMode(workspaceId: string, mode: ContinuoPermissionMode): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.store.update(workspaceId, (current) => ({ ...current, permissionMode: mode }));
    const line = currentTrajectory(doc);
    const session = line === undefined ? undefined : getLiveSessionById(this.core.accessor, line.sessionId);
    if (session !== undefined) (await mainAgentOf(session)).accessor.get(IAgentLifecycleService).broadcastPermissionMode(mode);
    return doc;
  }

  private async prepareWorker(agent: IAgentScopeHandle, workspaceId: string): Promise<void> {
    await this.ensureModel(agent);
    const mode = (await this.requireDoc(workspaceId)).permissionMode ?? 'manual';
    agent.accessor.get(IAgentLifecycleService).broadcastPermissionMode(mode);
  }

  private async ensureModel(agent: IAgentScopeHandle): Promise<void> {
    const profile = agent.accessor.get(IAgentProfileService);
    if (profile.data().modelAlias !== undefined) return;
    const alias = this.core.accessor.get(IConfigService).get<string | undefined>('defaultModel');
    if (alias !== undefined && alias !== '') await profile.setModel(alias);
  }

  private attach(workspaceId: string, taskId: string, session: ISessionScopeHandle, agent: IAgentScopeHandle): void {
    this.attachments.get(taskId)?.dispose();
    const sessionId = session.accessor.get(ISessionContext).sessionId;
    for (const [other, attachment] of this.attachments) {
      if (attachment.sessionId !== sessionId || other === taskId) continue;
      attachment.dispose();
      this.attachments.delete(other);
    }
    const events = agent.accessor.get(IEventBus);
    const activity = session.accessor.get(ISessionActivityView);
    const onEvent = events.subscribe((event) => { void this.onAgentEvent(workspaceId, taskId, event as unknown as Record<string, unknown>); });
    const onActivity = activity.onDidChange((change) => {
      void this.patchTask(workspaceId, taskId, (current) => {
        if (current.status !== 'running' && current.status !== 'awaiting_user') return current;
        const pending = change.state.pendingInteraction;
        if (pending !== 'none') return { ...current, status: 'awaiting_user', pendingInteraction: pending, phase: pending === 'question' ? '等待你回答' : '等待你批准' };
        if (current.status === 'awaiting_user' && change.state.busy) return { ...current, status: 'running', pendingInteraction: 'none', phase: undefined };
        return current;
      });
    });
    this.attachments.set(taskId, { dispose: () => { onEvent.dispose(); onActivity.dispose(); }, writes: new Map(), reads: new Set(), reply: '', prompt: '', sessionId });
  }

  private async onAgentEvent(workspaceId: string, taskId: string, event: Record<string, unknown>): Promise<void> {
    const type = event['type'];
    if (type === 'turn.started') {
      const attachment = this.attachments.get(taskId);
      if (attachment !== undefined) { attachment.reply = ''; attachment.writes.clear(); attachment.reads.clear(); }
      return;
    }
    if (type === 'assistant.delta') {
      const attachment = this.attachments.get(taskId);
      if (attachment !== undefined && typeof event['delta'] === 'string') attachment.reply += event['delta'];
      return;
    }
    if (type === 'turn.step.completed') {
      const usage = (event['usage'] as { inputOther?: number; output?: number; inputCacheRead?: number; inputCacheCreation?: number } | undefined) ?? {};
      await this.patchTask(workspaceId, taskId, (current) => ({
        ...current,
        usage: {
          steps: current.usage.steps + 1,
          inputTokens: current.usage.inputTokens + (usage.inputOther ?? 0) + (usage.inputCacheCreation ?? 0),
          cacheReadTokens: current.usage.cacheReadTokens + (usage.inputCacheRead ?? 0),
          outputTokens: current.usage.outputTokens + (usage.output ?? 0),
        },
      }));
      return;
    }
    if (type === 'tool.call.started') {
      const attachment = this.attachments.get(taskId);
      const turnId = typeof event['turnId'] === 'number' ? event['turnId'] : undefined;
      const written = writtenPath(event['display']);
      if (written !== undefined) attachment?.writes.set(String(event['toolCallId']), { path: written, turnId });
      const read = readPath(event['display']);
      if (read !== undefined) attachment?.reads.add(read);
      if (read !== undefined && this.requireTask(await this.requireDoc(workspaceId), taskId).kind === 'init') {
        const doc = await this.requireDoc(workspaceId);
        const rel = this.relativeToRoot(doc.root, read);
        await this.patchTask(workspaceId, taskId, (current) => ((current.sources ?? []).includes(rel) ? current : { ...current, sources: [...(current.sources ?? []), rel].slice(0, 40) }));
      }
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, phase: phaseOf(typeof event['name'] === 'string' ? event['name'] : '', read ?? written) }));
      return;
    }
    if (type === 'tool.result') {
      if (event['isError'] === true) this.attachments.get(taskId)?.writes.delete(String(event['toolCallId']));
      return;
    }
    if (type === 'turn.ended') {
      const reason = String(event['reason']);
      await this.finishTurn(workspaceId, taskId, reason, event['error'] as TurnError | undefined);
    }
  }

  private async finishTurn(workspaceId: string, taskId: string, reason: string, error: TurnError | undefined): Promise<void> {
    await this.settleTurn(workspaceId, taskId, reason, error);
    await this.writePlanFiles(workspaceId, taskId);
    await this.writeWorkLog(workspaceId, taskId);
    const doc = await this.requireDoc(workspaceId);
    const queued = doc.decisions.find((decision) => decision.taskId === taskId && isExploring(decision) && decision.exploration!.angles.every((angle) => angle.status === 'queued'));
    if (queued !== undefined && this.requireTask(doc, taskId).status === 'running') {
      await this.startExploration(workspaceId, queued.decisionId);
      return;
    }
    if (queued !== undefined) await this.finishExploration(workspaceId, queued.decisionId, undefined);
    await this.takeSnapshot(workspaceId, taskId);
  }

  private async startExploration(workspaceId: string, decisionId: string): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const home = lineById(doc, decision.trajectoryId);
    if (home === undefined) {
      await this.finishExploration(workspaceId, decisionId, '没能开始');
      return;
    }
    for (const angle of decision.exploration!.angles) {
      if (!isExploring(this.requireDecision(await this.requireDoc(workspaceId), decisionId))) return;
      try {
        const meta = await this.forkWhenIdle(doc, home.sessionId, decision.turnIndex, `Continuo · 方案 ${angle.key}`);
        const session = await resumeSessionById(this.core.accessor, meta.id);
        if (session === undefined) throw new Error('复制出的对话没能打开');
        const agent = await mainAgentOf(session);
        await this.ensureModel(agent);
        agent.accessor.get(IAgentLifecycleService).broadcastPermissionMode('auto');
        await this.patchAngle(workspaceId, decisionId, angle.key, (current) => ({ ...current, status: 'running', sessionId: meta.id }));
        if (!isExploring(this.requireDecision(await this.requireDoc(workspaceId), decisionId))) return;
        this.attachExplorer(workspaceId, decisionId, angle.key, meta.id, agent);
        agent.accessor.get(IAgentLoopService).submit({
          message: { role: 'user', content: [{ type: 'text', text: `Write plan ${angle.key}: ${angle.title}. ${angle.angle}` }] },
          meta: { promptId: `msg_${ulid()}`, origin: { kind: 'user' }, tracked: true },
        } as Parameters<IAgentLoopService['submit']>[0]);
      } catch (error) {
        const note = `没能开始（${String((error as Error).message).slice(0, 120)}）`;
        await this.patchAngle(workspaceId, decisionId, angle.key, (current) => ({ ...current, status: 'failed', note }));
      }
    }
    await this.settleExploration(workspaceId, decisionId);
  }

  private attachExplorer(workspaceId: string, decisionId: string, key: string, sessionId: string, agent: IAgentScopeHandle): void {
    const subscription = agent.accessor.get(IEventBus).subscribe((event) => { void this.onExplorerEvent(workspaceId, decisionId, key, sessionId, event as unknown as Record<string, unknown>); });
    this.explorers.set(sessionId, { dispose: () => subscription.dispose(), agent, decisionId, key });
  }

  private async onExplorerEvent(workspaceId: string, decisionId: string, key: string, sessionId: string, event: Record<string, unknown>): Promise<void> {
    const explorer = this.explorers.get(sessionId);
    if (explorer === undefined) return;
    if (event['type'] === 'turn.step.completed') {
      const usage = (event['usage'] as { inputOther?: number; output?: number; inputCacheRead?: number; inputCacheCreation?: number } | undefined) ?? {};
      let over = false;
      await this.patchAngle(workspaceId, decisionId, key, (current, maxSteps) => {
        const before = current.usage ?? EMPTY_USAGE;
        const steps = current.steps + 1;
        over = current.status === 'running' && steps >= maxSteps;
        return {
          ...current,
          steps,
          usage: {
            steps: before.steps + 1,
            inputTokens: before.inputTokens + (usage.inputOther ?? 0) + (usage.inputCacheCreation ?? 0),
            cacheReadTokens: before.cacheReadTokens + (usage.inputCacheRead ?? 0),
            outputTokens: before.outputTokens + (usage.output ?? 0),
          },
        };
      });
      if (over) explorer.agent.accessor.get(IAgentLoopService).cancel(undefined, 'step budget used up');
      return;
    }
    if (event['type'] !== 'turn.ended') return;
    explorer.dispose();
    this.explorers.delete(sessionId);
    const reason = String(event['reason']);
    const error = (event['error'] as { message?: string } | undefined)?.message;
    await this.patchAngle(workspaceId, decisionId, key, (current) => {
      if (current.status !== 'running') return current;
      const note = reason === 'cancelled' ? '步数用完了' : reason === 'failed' || reason === 'blocked' ? `出错了（${(error ?? reason).slice(0, 120)}）` : '中途结束了';
      return { ...current, status: 'failed', note };
    });
    await this.settleExploration(workspaceId, decisionId);
  }

  private async settleExploration(workspaceId: string, decisionId: string): Promise<void> {
    const decision = (await this.requireDoc(workspaceId)).decisions.find((candidate) => candidate.decisionId === decisionId);
    if (decision === undefined || !isExploring(decision)) return;
    if (decision.exploration!.angles.every((angle) => FINAL_ANGLE.has(angle.status))) await this.finishExploration(workspaceId, decisionId, undefined);
  }

  private async finishExploration(workspaceId: string, decisionId: string, stopped: string | undefined): Promise<void> {
    for (const [sessionId, explorer] of this.explorers) {
      if (explorer.decisionId !== decisionId) continue;
      explorer.dispose();
      this.explorers.delete(sessionId);
      explorer.agent.accessor.get(IAgentLoopService).cancel(undefined, 'exploration stopped');
    }
    const endedAt = new Date().toISOString();
    let decision: Decision | undefined;
    await this.store.update(workspaceId, (current) => {
      const target = current.decisions.find((candidate) => candidate.decisionId === decisionId);
      if (target === undefined || !isExploring(target)) return current;
      const angles = target.exploration!.angles.map((angle) => (FINAL_ANGLE.has(angle.status) ? angle : { ...angle, status: 'failed' as const, note: stopped ?? '中途结束了' }));
      decision = { ...target, exploration: { ...target.exploration!, angles, endedAt } };
      if (target.plans.length === 0) return { ...current, decisions: current.decisions.filter((candidate) => candidate.decisionId !== decisionId) };
      return { ...current, decisions: current.decisions.map((candidate) => (candidate.decisionId === decisionId ? decision! : candidate)) };
    });
    if (decision === undefined) return;
    const taskId = decision.taskId;
    const count = decision.exploration!.angles.length;
    const started = decision.exploration!.angles.some((angle) => angle.sessionId !== undefined);
    if (decision.plans.length === 0 && !started) {
      await this.writeWorkLog(workspaceId, taskId);
      return;
    }
    if (decision.plans.length > 1 && stopped === undefined && await this.askToRecommend(workspaceId, decision)) {
      await this.writePlanFiles(workspaceId, taskId);
      return;
    }
    if (decision.plans.length > 0) {
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'awaiting_user', pendingInteraction: 'choice', phase: '等你选方案', pauseRequested: false, endedAt }));
      await this.writePlanFiles(workspaceId, taskId);
    } else {
      const status: TaskStatus = stopped === '已停止' ? 'paused' : stopped === '被打断' ? 'interrupted' : 'failed';
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status, phase: undefined, pendingInteraction: 'none', lastError: `分头写的 ${count} 个方案都没能完成`, endedAt }));
    }
    await this.writeWorkLog(workspaceId, taskId);
    await this.takeSnapshot(workspaceId, taskId);
  }

  private async askToRecommend(workspaceId: string, decision: Decision): Promise<boolean> {
    const task = this.requireTask(await this.requireDoc(workspaceId), decision.taskId);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) return false;
    const agent = await mainAgentOf(session);
    await this.prepareWorker(agent, workspaceId);
    this.attach(workspaceId, task.taskId, session, agent);
    const list = decision.plans.map((plan) => `- 「${plan.title}」：${plan.path}`).join('\n');
    const promptId = await this.sendTurn(workspaceId, task.taskId, agent, `分头写的方案都交上来了：\n${list}\n比较一下：先说清楚选哪个取决于什么；如果材料里有事实能定下来，再说你建议哪个、为什么。先不要开始任何一个。`, '比较方案');
    await this.patchTask(workspaceId, task.taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: '在比较方案', pauseRequested: false, promptIds: [...current.promptIds, promptId], endedAt: undefined }));
    return true;
  }

  private async patchAngle(workspaceId: string, decisionId: string, key: string, mutate: (angle: ExplorationAngle, maxSteps: number) => ExplorationAngle): Promise<void> {
    await this.store.update(workspaceId, (current) => ({
      ...current,
      decisions: current.decisions.map((decision) => (decision.decisionId !== decisionId || !isExploring(decision)
        ? decision
        : { ...decision, exploration: { ...decision.exploration!, angles: decision.exploration!.angles.map((angle) => (angle.key === key ? mutate(angle, decision.exploration!.maxSteps) : angle)) } })),
    }));
  }

  private async takeSnapshot(workspaceId: string, taskId: string): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    const line = trajectoryOfSession(doc, task.sessionId);
    if (task.kind !== 'user' || line === undefined) return;
    const open = openDecisionOf(doc, line, taskId);
    if (open !== undefined && isExploring(open)) return;
    if (!canCopyProject(doc)) return;
    const label = open === undefined ? `task/${taskId}` : `decision/${open.decisionId}`;
    const commit = await snapshotDir(doc.root, lineRoot(doc, line), label);
    if (commit === undefined) return;
    await this.store.update(workspaceId, (current) => (open === undefined
      ? { ...current, tasks: current.tasks.map((candidate) => (candidate.taskId === taskId ? { ...candidate, snapshot: commit } : candidate)) }
      : { ...current, decisions: current.decisions.map((candidate) => (candidate.decisionId === open.decisionId ? { ...candidate, snapshot: commit } : candidate)) }));
  }

  private async settleTurn(workspaceId: string, taskId: string, reason: string, error: TurnError | undefined): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    const endedAt = new Date().toISOString();
    const root = rootOfTask(doc, task);
    if (task.kind === 'user') await this.recordRound(workspaceId, taskId, root, endedAt);
    if (reason === 'cancelled') {
      const status: TaskStatus = task.pauseRequested ? 'paused' : 'interrupted';
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status, phase: undefined, pendingInteraction: 'none', endedAt }));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'stopped', endedAt } }));
      return;
    }
    if (reason === 'failed' || reason === 'blocked') {
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'failed', phase: undefined, pendingInteraction: 'none', lastError: friendlyError(error?.message ?? reason), error: taskErrorOf(error, reason, endedAt), endedAt }));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'failed', endedAt } }));
      return;
    }
    if (task.kind === 'init') {
      await this.store.update(workspaceId, (current) => ({
        ...current,
        init: { ...current.init, status: current.scan?.truncated === true ? 'partial' : 'completed', endedAt },
        todos: this.suggestedTodos(current, taskId, current.understanding?.suggestions ?? [], endedAt),
        tasks: current.tasks.map((candidate) => (candidate.taskId === taskId ? { ...candidate, status: 'completed' as TaskStatus, phase: undefined, endedAt, updatedAt: endedAt } : candidate)),
      }));
      return;
    }
    const settled = await this.requireDoc(workspaceId);
    const line = trajectoryOfSession(settled, task.sessionId);
    const open = line === undefined ? undefined : openDecisionOf(settled, line, taskId);
    if (open !== undefined) {
      const reply = (this.attachments.get(taskId)?.reply ?? '').trim().slice(0, 4000);
      const exploring = isExploring(open);
      await this.patchTask(workspaceId, taskId, (current) => (exploring
        ? { ...current, status: 'running' as TaskStatus, pendingInteraction: 'none' as const, phase: `正在分头写 ${open.exploration!.angles.length} 个方案`, lastReply: reply === '' ? current.lastReply : reply }
        : { ...current, status: 'awaiting_user' as TaskStatus, pendingInteraction: 'choice' as const, phase: '等你选方案', lastReply: reply === '' ? current.lastReply : reply }));
      return;
    }
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'verifying', phase: '核验交付' }));
    const fresh = await this.requireDoc(workspaceId);
    const current = this.requireTask(fresh, taskId);
    const notes: string[] = [];
    const observedWrites = new Map<string, number | undefined>();
    for (const item of this.attachments.get(taskId)?.writes.values() ?? []) observedWrites.set(this.relativeToRoot(root, item.path), item.turnId);
    const observed = [...observedWrites.keys()];
    let report = current.report;
    if (report === undefined && observed.length > 0) {
      report = { summary: '产物由实际写入的文件推断得出；Agent 这次没有上报。', deliverables: observed.map((path) => ({ path, note: '实际写入', turnId: observedWrites.get(path) })), unresolved: [], reportedAt: endedAt };
      notes.push('agent did not report; deliverables inferred from observed writes');
    } else if (report === undefined) {
      const reply = (this.attachments.get(taskId)?.reply ?? '').trim().slice(0, 4000);
      await this.patchTask(workspaceId, taskId, (candidate) => ({ ...candidate, status: 'awaiting_user' as TaskStatus, pendingInteraction: 'reply' as const, phase: '已回复，等你确认或继续', lastReply: reply === '' ? undefined : reply, verification: ['no files written and no result report; the agent replied and is waiting for you'] }));
      return;
    } else {
      report = { ...report, deliverables: report.deliverables.map((item) => {
        const rel = this.relativeToRoot(root, item.path);
        return observedWrites.has(rel) ? { ...item, path: rel, turnId: observedWrites.get(rel) } : item;
      }) };
      const reported = new Set(report.deliverables.map((item) => this.relativeToRoot(root, item.path)));
      const unreported = observed.filter((path) => !reported.has(path));
      if (unreported.length > 0) {
        report = { ...report, deliverables: [...report.deliverables, ...unreported.map((path) => ({ path, note: '写了但没上报', turnId: observedWrites.get(path) }))] };
        notes.push(`written but not reported: ${unreported.join(', ')}`);
      }
    }
    let deliverables = report?.deliverables ?? [];
    if (report !== undefined) {
      deliverables = await Promise.all(deliverables.map(async (item) => ({ ...item, exists: await this.exists(root, item.path) })));
      for (const item of deliverables) if (item.exists === false) notes.push(`reported file missing: ${item.path}`);
      for (const item of report.unresolved) notes.push(`unresolved: ${item}`);
    }
    const missing = deliverables.some((item) => item.exists === false);
    const status: TaskStatus = missing || (report?.unresolved.length ?? 0) > 0 ? 'needs_review' : 'completed';
    const finalReport = report === undefined ? undefined : { ...report, deliverables };
    const lastReply = (this.attachments.get(taskId)?.reply ?? '').trim().slice(0, 4000);
    await this.patchTask(workspaceId, taskId, (candidate) => ({
      ...candidate,
      status,
      phase: undefined,
      pendingInteraction: 'none',
      verification: notes,
      report: finalReport,
      lastReply: lastReply === '' ? candidate.lastReply : lastReply,
      endedAt,
    }));
    const nextStep = finalReport?.nextStep;
    if (nextStep !== undefined) await this.store.update(workspaceId, (current) => ({ ...current, todos: this.suggestedTodos(current, taskId, [nextStep], endedAt) }));
  }

  private async recordRound(workspaceId: string, taskId: string, root: string, at: string): Promise<void> {
    const attachment = this.attachments.get(taskId);
    if (attachment === undefined) return;
    const reads = [...new Set([...attachment.reads].map((path) => this.relativeToRoot(root, path)))].slice(0, 20);
    const writes = [...new Set([...attachment.writes.values()].map((item) => this.relativeToRoot(root, item.path)))].slice(0, 20);
    const round: TaskRound = { at, prompt: attachment.prompt.slice(0, 400), reads, writes, reply: attachment.reply.trim().slice(0, 600), turnIndex: attachment.turnIndex };
    attachment.prompt = '';
    if (round.prompt === '' && round.reply === '' && reads.length === 0 && writes.length === 0) return;
    await this.patchTask(workspaceId, taskId, (current) => ({
      ...current,
      rounds: [...(current.rounds ?? []), round].slice(-20),
      sources: [...new Set([...(current.sources ?? []), ...reads])].slice(0, 40),
    }));
  }

  private async writeWorkLog(workspaceId: string, taskId: string): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) return;
    const root = rootOfTask(doc, task);
    const dir = resolve(root, WORK_LOG_DIR);
    try {
      await mkdir(dir, { recursive: true });
      const earlierInit = task.kind === 'init' && task.logPath === undefined ? doc.tasks.findLast((candidate) => candidate.kind === 'init' && candidate.logPath !== undefined)?.logPath : undefined;
      const path = earlierInit ?? await this.logPathFor(dir, task);
      if (task.logPath !== undefined && task.logPath !== path) {
        await rename(resolve(root, task.logPath), resolve(root, path)).catch(() => undefined);
      }
      await writeFile(resolve(root, path), renderWorkLog(doc, task), 'utf8');
      if (task.logPath !== path) await this.patchTask(workspaceId, taskId, (current) => ({ ...current, logPath: path }));
    } catch {
      return;
    }
  }

  private async logPathFor(dir: string, task: ContinuoTask): Promise<string> {
    const day = localDay(task.endedAt ?? task.createdAt);
    const base = ['work-log', day, taskCategory(task), logSlug(taskName(task)), task.branch?.label].filter((part) => part !== undefined && part !== '').join('-');
    if (task.logPath?.startsWith(`${WORK_LOG_DIR}/${base}`) === true) return task.logPath;
    const taken = new Set(await readdir(dir).catch(() => []));
    let name = `${base}.md`;
    for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}.md`;
    return `${WORK_LOG_DIR}/${name}`;
  }

  private relativeToRoot(root: string, path: string): string {
    if (!isAbsolute(path)) return path;
    const rel = relative(root, path);
    return rel.startsWith('..') ? path : rel;
  }

  private async exists(root: string, path: string): Promise<boolean> {
    const abs = isAbsolute(path) ? path : resolve(root, path);
    const rel = relative(root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
    try { await stat(abs); return true; } catch { return false; }
  }

  private async patchTask(workspaceId: string, taskId: string, mutate: (task: ContinuoTask) => ContinuoTask): Promise<ContinuoWorkspaceDoc> {
    return this.store.update(workspaceId, (current) => {
      const now = new Date().toISOString();
      let changed = false;
      const tasks = current.tasks.map((task) => {
        if (task.taskId !== taskId) return task;
        const next = mutate(task);
        if (next === task) return task;
        changed = true;
        return { ...next, updatedAt: now };
      });
      if (!changed) return current;
      return { ...current, tasks };
    });
  }

  private async requireDoc(workspaceId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.store.load(workspaceId);
    if (doc === undefined) throw new ContinuoError('workspace_not_found', '这个项目还没有打开过。');
    return doc;
  }

  private requireTask(doc: ContinuoWorkspaceDoc, taskId: string): ContinuoTask {
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) throw new ContinuoError('task_not_found', '这件事找不到了。');
    return task;
  }
}

const DONE = new Set<TaskStatus>(['completed', 'needs_review']);


function stamp(iso: string | undefined): string {
  return iso === undefined ? '' : `${localDay(iso)} ${localTime(iso)}`;
}

function oneLine(text: string, max: number): string {
  const line = text.split('\n').map((part) => part.trim()).filter((part) => part !== '').join(' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function planPrompt(plan: TrajectoryPlan): string {
  return `按「${plan.title}」继续：${plan.prompt}`;
}

function decisionsOfTask(doc: ContinuoWorkspaceDoc, task: ContinuoTask): Array<{ decision: Decision }> {
  return doc.decisions.filter((decision) => decision.taskId === task.taskId).map((decision) => ({ decision }));
}

function planStatusText(doc: ContinuoWorkspaceDoc, task: ContinuoTask, decision: Decision, plan: TrajectoryPlan): string {
  if (plan.abandoned !== undefined) return plan.abandoned.reason === undefined ? '已放弃' : `已放弃：${plan.abandoned.reason}`;
  const line = trajectoryOfSession(doc, task.sessionId);
  if (line === undefined) return '备选';
  const status = planStatusOn(doc, line, decision, plan);
  if (status.kind === 'current') return '本事项采用';
  if (status.kind === 'elsewhere') return '在另一条轨迹上执行';
  return '备选';
}

function planFileStatus(doc: ContinuoWorkspaceDoc, decision: Decision, plan: TrajectoryPlan): string {
  if (plan.abandoned !== undefined) return '已放弃';
  const followed = doc.trajectories.filter((line) => line.status !== 'abandoned' && choiceOn(line, decision.decisionId)?.planId === plan.planId).length;
  return followed === 0 ? '备选' : '已执行';
}

function renderPlan(doc: ContinuoWorkspaceDoc, task: ContinuoTask, decision: Decision, plan: TrajectoryPlan): string {
  const category = taskCategory(task);
  const lines = [
    `# 方案 ${plan.planId}：${plan.title}`,
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 决策点 | ${decision.question} |`,
    `| 事项 | ${taskName(task)}${category === undefined ? '' : `（${category}）`} |`,
    `| 提出时间 | ${stamp(plan.createdAt)} |`,
    `| 状态 | ${planFileStatus(doc, decision, plan)} |`,
    '',
    ...(plan.fit === undefined ? [] : ['## 适合', '', plan.fit.trim(), '']),
    ...(decision.stance?.pick === plan.planId && decision.stance.why !== undefined ? ['## 为什么建议', '', decision.stance.why.trim(), ''] : []),
    ...(plan.caution === undefined ? [] : ['## 不建议', '', plan.caution.trim(), '']),
    '## 依据',
    '',
    plan.basis.trim(),
    '',
    '## 风险',
    '',
    plan.risk.trim(),
  ];
  if (plan.detail !== undefined && plan.detail.trim() !== '') lines.push('', '## 详情', '', plan.detail.trim());
  lines.push('', '## 选这个方案时发送', '', `> ${oneLine(plan.prompt, 800)}`);
  if (plan.abandoned?.reason !== undefined) lines.push('', '## 放弃原因', '', plan.abandoned.reason);
  return `${lines.join('\n')}\n`;
}

function renderWorkLog(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string {
  const name = taskName(task);
  const category = taskCategory(task);
  const lines = [`# 工作日志：${name}${category === undefined ? '' : `（${category}）`}`, ''];
  if (task.kind === 'init') {
    lines.push(...renderInitLog(doc, task));
    return `${lines.join('\n')}\n`;
  }
  lines.push(...renderStar(doc, task), '', '---', '', `## Session: ${stamp(task.createdAt)} - ${name}`, '', ...renderSession(doc, task));
  return `${lines.join('\n')}\n`;
}

function renderInitLog(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const lines = ['| 字段 | 值 |', '|------|-----|', `| 开始时间 | ${stamp(task.createdAt)} |`];
  if (task.endedAt !== undefined) lines.push(`| 结束时间 | ${stamp(task.endedAt)} |`);
  lines.push(`| 状态 | ${TASK_STATUS_LABEL[task.status]} |`, `| 项目目录 | ${doc.root} |`);
  if (doc.understanding !== undefined) lines.push('', '## 这个项目是什么', '', doc.understanding.text.trim());
  if (doc.context.length > 0) {
    lines.push('', '## 项目要点', '');
    for (const entry of doc.context) lines.push(`- ${entry.text}${entry.sourceRefs.length > 0 ? `（来源：${entry.sourceRefs.join('、')}）` : ''}`);
  }
  return lines;
}

function renderStar(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const rounds = task.rounds ?? [];
  const points = doc.context.slice(0, 3).map((entry) => entry.text.trim().replace(/[。.；;]$/, '')).join('；');
  const situation = [
    `${stamp(task.createdAt)}，在项目 ${doc.root.split('/').filter(Boolean).pop() ?? doc.root}${task.category === undefined ? '' : `，分类 ${task.category}`}。`,
    doc.understanding === undefined ? '' : oneLine(doc.understanding.text, 200),
    points === '' ? '' : `项目约定：${points}`,
  ].filter((part) => part !== '').join(' ');
  const pending = !DONE.has(task.status);
  const reads = [...new Set(rounds.flatMap((round) => round.reads))];
  const writes = [...new Set(rounds.flatMap((round) => round.writes))];
  const action = pending
    ? '⏳ 待阶段完成'
    : [
        `共 ${rounds.length} 轮。`,
        reads.length === 0 ? '' : `读了 ${reads.join('、')}。`,
        writes.length === 0 ? '' : `写出 ${writes.join('、')}。`,
        (task.supplements ?? []).length === 0 ? '' : `中途补充：${(task.supplements ?? []).map((item) => oneLine(item, 60)).join('；')}。`,
        ...decisionsOfTask(doc, task).map(({ decision }) => `在「${decision.question}」给出 ${decision.plans.length} 个方案：${decision.plans.map((plan) => `${plan.planId} ${plan.title}（${planStatusText(doc, task, decision, plan)}）`).join('、')}。`),
      ].filter((part) => part !== '').join('');
  const deliverables = task.report?.deliverables ?? [];
  const missing = deliverables.filter((item) => item.exists === false).length;
  const result = pending
    ? '⏳ 待阶段完成'
    : [
        task.report === undefined ? '' : oneLine(task.report.summary, 300),
        deliverables.length === 0 ? '' : `产物 ${deliverables.length} 份，${missing === 0 ? '已逐个核对存在' : `其中 ${missing} 份不存在`}。`,
        (task.report?.unresolved ?? []).length === 0 ? '' : `遗留：${(task.report?.unresolved ?? []).join('；')}。`,
      ].filter((part) => part !== '').join(' ');
  return [
    '## STAR',
    `- **Situation**: ${situation}`,
    `- **Task**: ${oneLine(rounds[0]?.prompt ?? task.title, 300)}`,
    `- **Action**: ${action}`,
    `- **Result**: ${result}`,
  ];
}

function renderSession(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const rounds = task.rounds ?? [];
  const sources = task.sources ?? [];
  const deliverables = task.report?.deliverables ?? [];
  const lines = ['### Meta Data', '', '| 字段 | 值 |', '|------|-----|', `| 开始时间 | ${stamp(task.createdAt)} |`];
  if (task.endedAt !== undefined) lines.push(`| 结束时间 | ${stamp(task.endedAt)} |`);
  lines.push(`| 状态 | ${TASK_STATUS_LABEL[task.status]}${task.lastError === undefined ? '' : `（${task.lastError}）`} |`);
  lines.push(`| 输入目录 | ${rootOfTask(doc, task)} |`);
  lines.push(`| 输入文件 | ${sources.length === 0 ? '—' : sources.join(', ')} |`);
  const plans = decisionsOfTask(doc, task).flatMap(({ decision }) => decision.plans.map((plan) => ({ decision, plan })));
  const outputs = [...deliverables.map((item) => item.path), ...plans.map(({ plan }) => plan.path)];
  lines.push(`| 输出文件 | ${outputs.length === 0 ? '—' : outputs.join(', ')} |`);
  lines.push('', '### 原始任务描述', '', `> ${oneLine(rounds[0]?.prompt ?? task.title, 600)}`);
  if (rounds.length > 0) {
    lines.push('', '### 工作记录');
    for (const [index, round] of rounds.entries()) {
      const label = index === 0 ? taskName(task) : oneLine(round.prompt, 16);
      lines.push('', `#### [${localTime(round.at)}] 对话 ${index + 1} - ${label === '' ? '继续' : label}`);
      lines.push(`**输入**: ${index === 0 ? '同原始任务描述' : oneLine(round.prompt, 200)}`);
      const handled = [round.reads.length === 0 ? '' : `读 ${round.reads.join('、')}`, oneLine(round.reply, 200)].filter((part) => part !== '');
      lines.push(`**处理**: ${handled.length === 0 ? '—' : handled.join('；')}`);
      lines.push(`**产出**: ${round.writes.length === 0 ? '无文件产出' : round.writes.join('、')}`);
    }
  }
  if (deliverables.length > 0 || plans.length > 0) {
    lines.push('', '### 最终产出', '', '| 文件 | 说明 | 状态 |', '|------|------|------|');
    for (const item of deliverables) lines.push(`| ${item.path} | ${item.note === undefined || item.note === '' ? '—' : item.note} | ${item.exists === false ? '❌ 不存在' : '✅'} |`);
    for (const { decision, plan } of plans) lines.push(`| ${plan.path} | 方案 ${plan.planId}：${plan.title} | ${planStatusText(doc, task, decision, plan)} |`);
  }
  const notes = [
    ...(task.report?.unresolved ?? []).map((item) => `- 未完成：${item}`),
    ...(task.report?.nextStep === undefined ? [] : [`- 建议的下一步：${task.report.nextStep.title}——${task.report.nextStep.reason}`]),
  ];
  if (notes.length > 0) lines.push('', '### 备注', '', ...notes);
  return lines;
}
