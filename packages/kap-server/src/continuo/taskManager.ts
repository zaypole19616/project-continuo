import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  CONTINUO_WORKER_PROFILE,
  EMPTY_USAGE,
  IContinuoStore,
  ISessionContext,
  IWorkspaceService,
  buildTrajectoryExport,
  currentTrajectory,
  dueTodo,
  isExploring,
  openDecisionOf,
  rootOfTask,
  taskName,
  trajectoryOfSession,
  type ContinuoPermissionMode,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type DeliverableFeedback,
  type Scope,
  type TaskRound,
  type TaskStatus,
  type TodoTiming,
  type TrajectoryExport,
} from '@moonshot-ai/agent-core-v2';

import { Decisions, takeSnapshot } from './decisions';
import { patchTask, patchTaskIn, requireDoc, requireTask } from './doc';
import { ContinuoError } from './errors';
import { hiddenTurnFirstRead, mainTurnResume, mainTurnUser } from './prompts';
import { writePlanFiles, writeWorkLog } from './render';
import { scanWorkspace } from './scan';
import { asksUser, assertIdle, interruptedOnRestart, isBusy, isLiveBusy, phaseOf, readPath, started, taskErrorOf, toAwaiting, toEnded, toRunning, writtenPath, type TurnError } from './taskState';
import { acceptTodo, addTodo, dismissTodo, finishTodoRun, openTodo, removeTodo, suggestedTodos } from './todos';
import { NO_MODEL, Workers } from './workers';

export { ContinuoError } from './errors';

const STALE_MS = 60_000;

export class ContinuoTaskManager {
  readonly decisions: Decisions;
  private readonly workers: Workers;
  private readonly requests = new Map<string, string>();
  private readonly creating = new Map<string, Promise<unknown>>();
  private readonly opening = new Map<string, Promise<ContinuoWorkspaceDoc>>();

  constructor(private readonly core: Scope) {
    this.workers = new Workers(core, (workspaceId, taskId, event) => this.onAgentEvent(workspaceId, taskId, event));
    this.decisions = new Decisions(core, this.workers);
  }

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
    let doc = await this.store.update(workspaceId, (current) => this.interruptDead({ ...current, root: workspace.root, openCount: current.openCount + 1 }, () => true));
    for (const decision of doc.decisions) {
      if (isExploring(decision) && !this.workers.has(decision.taskId)) await this.decisions.finishExploration(workspaceId, decision.decisionId, '被打断');
    }
    doc = await requireDoc(this.store, workspaceId);
    const initTaskId = doc.init.taskId;
    if (initTaskId !== undefined && (doc.init.status === 'completed' || doc.init.status === 'partial') && (doc.understanding?.suggestions ?? []).length > 0 && !(doc.todos ?? []).some((todo) => todo.fromTaskId === initTaskId)) {
      doc = await this.store.update(workspaceId, (current) => ({ ...current, todos: suggestedTodos(current, initTaskId, current.understanding?.suggestions ?? [], current.init.endedAt ?? new Date().toISOString()) }));
    }
    if (doc.init.status === 'pending') {
      doc = await this.startInit(doc);
    } else if (doc.init.status === 'running' && !this.workers.isLive(doc.init.taskId, doc)) {
      doc = await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: current.understanding === undefined ? 'stopped' : 'completed', endedAt: new Date().toISOString() } }));
    }
    return doc;
  }

  async retryInit(workspaceId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    if (doc.init.status === 'running' && this.workers.isLive(doc.init.taskId, doc)) return doc;
    return this.startInit(doc);
  }

  async snapshot(workspaceId: string): Promise<ContinuoWorkspaceDoc | undefined> {
    return this.store.load(workspaceId);
  }

  async exportTrajectories(workspaceId: string): Promise<TrajectoryExport> {
    const doc = await requireDoc(this.store, workspaceId);
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

  addTodo(workspaceId: string, text: string, timing: TodoTiming | undefined): Promise<ContinuoWorkspaceDoc> {
    return addTodo(this.store, workspaceId, text, timing);
  }

  removeTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    return removeTodo(this.store, workspaceId, todoId);
  }

  acceptTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    return acceptTodo(this.store, workspaceId, todoId);
  }

  dismissTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    return dismissTodo(this.store, workspaceId, todoId);
  }

  async startTodo(workspaceId: string, todoId: string): Promise<ContinuoWorkspaceDoc> {
    const todo = openTodo(await requireDoc(this.store, workspaceId), todoId);
    const { task } = await this.createUserTask(workspaceId, todo.text);
    return finishTodoRun(this.store, workspaceId, todo, Date.now(), task.taskId);
  }

  async runDueTodos(): Promise<void> {
    const now = Date.now();
    for (const workspaceId of await this.store.workspaceIds()) {
      const stored = await this.store.load(workspaceId).catch(() => undefined);
      if (stored === undefined || dueTodo(stored, now) === undefined) continue;
      const doc = await this.store.update(workspaceId, (current) => this.interruptDead(current, (task) => now - Date.parse(task.updatedAt) > STALE_MS));
      const todo = dueTodo(doc, now);
      if (todo === undefined || this.projectBusy(doc)) continue;
      try {
        const { task } = await this.createUserTask(workspaceId, todo.text);
        await finishTodoRun(this.store, workspaceId, todo, now, task.taskId);
      } catch {
        continue;
      }
    }
  }

  private projectBusy(doc: ContinuoWorkspaceDoc): boolean {
    return (doc.init.status === 'running' && this.workers.isLive(doc.init.taskId, doc)) || doc.tasks.some((task) => task.kind === 'user' && isLiveBusy(task, this.workers));
  }

  createUserTask(workspaceId: string, text: string, clientRequestId?: string): Promise<{ doc: ContinuoWorkspaceDoc; task: ContinuoTask }> {
    const previous = this.creating.get(workspaceId) ?? Promise.resolve();
    const run = previous.then(() => this.createUserTaskNow(workspaceId, text, clientRequestId));
    this.creating.set(workspaceId, run.catch(() => undefined));
    return run;
  }

  private async createUserTaskNow(workspaceId: string, text: string, clientRequestId?: string): Promise<{ doc: ContinuoWorkspaceDoc; task: ContinuoTask }> {
    const doc = await requireDoc(this.store, workspaceId);
    if (clientRequestId !== undefined) {
      const known = this.requests.get(`task:${workspaceId}:${clientRequestId}`);
      const existing = known === undefined ? undefined : doc.tasks.find((task) => task.taskId === known);
      if (existing !== undefined) return { doc, task: existing };
    }
    const running = doc.tasks.find((task) => task.kind === 'user' && isBusy(task));
    if (running !== undefined) {
      throw new ContinuoError('invalid_state', `「${taskName(running)}」还没结束，等它做完或停下后再交代新的事。`);
    }
    const line = currentTrajectory(doc);
    const session = line === undefined
      ? await this.workers.newSession(workspaceId, doc.root, CONTINUO_WORKER_PROFILE)
      : await this.workers.openSession(line.sessionId, '这条轨迹的对话记录找不到了。');
    const agent = await this.workers.prepare(session, workspaceId);
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
    this.workers.attach(workspaceId, taskId, session, agent);
    const promptId = await this.workers.sendTurn(workspaceId, taskId, agent, mainTurnUser(text));
    const updated = await patchTask(this.store, workspaceId, taskId, (current) => started(current, promptId));
    return { doc: updated, task: requireTask(updated, taskId) };
  }

  async pause(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const task = requireTask(doc, taskId);
    if (task.status !== 'running' && task.status !== 'awaiting_user' && task.status !== 'queued') return doc;
    await patchTask(this.store, workspaceId, taskId, (current) => ({ ...current, pauseRequested: true }));
    const exploring = doc.decisions.find((decision) => decision.taskId === taskId && isExploring(decision) && decision.exploration!.angles.some((angle) => angle.sessionId !== undefined));
    if (exploring !== undefined) {
      await this.decisions.finishExploration(workspaceId, exploring.decisionId, '已停止');
      return requireDoc(this.store, workspaceId);
    }
    if (await this.workers.cancel(task.sessionId, 'paused by user')) return requireDoc(this.store, workspaceId);
    return patchTask(this.store, workspaceId, taskId, (current) => toEnded(current, 'paused', new Date().toISOString()));
  }

  async resume(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const task = requireTask(doc, taskId);
    if (task.status !== 'paused' && task.status !== 'interrupted' && task.status !== 'needs_review' && task.status !== 'failed') {
      throw new ContinuoError('invalid_state', '这件事现在不能继续。');
    }
    const resumeLine = trajectoryOfSession(doc, task.sessionId);
    if (resumeLine !== undefined) assertIdle(doc, resumeLine);
    const agent = await this.workers.attachWorker(workspaceId, task);
    const promptId = await this.workers.sendTurn(workspaceId, taskId, agent, mainTurnResume(task));
    return patchTask(this.store, workspaceId, taskId, (current) => toRunning(current, { promptId, trigger: 'resume' }));
  }

  async steer(workspaceId: string, taskId: string, text: string): Promise<ContinuoWorkspaceDoc> {
    const task = requireTask(await requireDoc(this.store, workspaceId), taskId);
    if (task.status !== 'running' || !(await this.workers.steer(task.sessionId, text))) throw new ContinuoError('invalid_state', '这一步刚好结束了，再发送一次就好。');
    return patchTask(this.store, workspaceId, taskId, (current) => ({ ...current, supplements: [...(current.supplements ?? []), text] }));
  }

  async complete(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const task = requireTask(await requireDoc(this.store, workspaceId), taskId);
    if (task.status !== 'awaiting_user' || task.pendingInteraction !== 'reply') throw new ContinuoError('invalid_state', '这件事现在不能标为完成。');
    await patchTask(this.store, workspaceId, taskId, (current) => toEnded(current, 'completed', new Date().toISOString()));
    await writeWorkLog(this.store, workspaceId, taskId);
    return requireDoc(this.store, workspaceId);
  }

  async reply(workspaceId: string, taskId: string, text: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const task = requireTask(doc, taskId);
    if (task.kind !== 'user') throw new ContinuoError('invalid_state', '这件事不接受回复。');
    if (isBusy(task)) throw new ContinuoError('invalid_state', '这件事正在等你回答或批准，先处理那张卡片。');
    const line = trajectoryOfSession(doc, task.sessionId);
    if (line !== undefined) assertIdle(doc, line);
    const open = line === undefined || task.pendingInteraction !== 'choice' ? undefined : openDecisionOf(doc, line, taskId);
    const agent = await this.workers.attachWorker(workspaceId, task);
    if (line !== undefined && open !== undefined) {
      const at = new Date().toISOString();
      await this.store.update(workspaceId, (current) => ({
        ...current,
        trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === line.trajectoryId ? { ...candidate, choices: [...candidate.choices, { decisionId: open.decisionId, text, turnIndex: candidate.turnCount, at }] } : candidate)),
      }));
    }
    const promptId = await this.workers.sendTurn(workspaceId, taskId, agent, mainTurnUser(text));
    return patchTask(this.store, workspaceId, taskId, (current) => toRunning(current, { promptId, trigger: 'reply', supplement: text }));
  }

  async setPermissionMode(workspaceId: string, mode: ContinuoPermissionMode): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.store.update(workspaceId, (current) => ({ ...current, permissionMode: mode }));
    const line = currentTrajectory(doc);
    if (line !== undefined) await this.workers.broadcastPermissionMode(line.sessionId, mode);
    return doc;
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
    const opened = await this.workers.newInitAgent(workspaceId, doc.root).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (opened instanceof Error) {
      const error = { code: opened.message === NO_MODEL ? 'model.not_configured' : 'turn.failed', message: opened.message, at: now };
      const failed: ContinuoTask = { taskId, kind: 'init', title: '了解这个文件夹', trigger: 'first_open', sessionId: '', promptIds: [], status: 'failed', pauseRequested: false, usage: EMPTY_USAGE, createdAt: now, updatedAt: now, endedAt: now, error };
      return this.store.update(workspaceId, (current) => ({ ...current, scan, init: { status: 'failed', taskId, startedAt: now, endedAt: now }, tasks: [...current.tasks, failed] }));
    }
    const { session, agent } = opened;
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
    this.workers.attach(workspaceId, taskId, session, agent);
    const promptId = this.workers.submitPrompt(agent, taskId, hiddenTurnFirstRead(scan, doc.root), '');
    return patchTask(this.store, workspaceId, taskId, (current) => started(current, promptId));
  }

  private interruptDead(doc: ContinuoWorkspaceDoc, only: (task: ContinuoTask) => boolean): ContinuoWorkspaceDoc {
    const at = new Date().toISOString();
    return doc.tasks.reduce((current, task) => (only(task) && !this.workers.has(task.taskId) ? patchTaskIn(current, task.taskId, (candidate) => interruptedOnRestart(candidate, at)) : current), doc);
  }

  private async onAgentEvent(workspaceId: string, taskId: string, event: Record<string, unknown>): Promise<void> {
    const type = event['type'];
    const attachment = this.workers.attachmentOf(taskId);
    if (type === 'turn.started') {
      if (attachment !== undefined) { attachment.reply = ''; attachment.writes.clear(); attachment.reads.clear(); }
      return;
    }
    if (type === 'assistant.delta') {
      if (attachment !== undefined && typeof event['delta'] === 'string') attachment.reply += event['delta'];
      return;
    }
    if (type === 'turn.step.completed') {
      const usage = (event['usage'] as { inputOther?: number; output?: number; inputCacheRead?: number; inputCacheCreation?: number } | undefined) ?? {};
      await patchTask(this.store, workspaceId, taskId, (current) => ({
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
      const turnId = typeof event['turnId'] === 'number' ? event['turnId'] : undefined;
      const written = writtenPath(event['display']);
      if (written !== undefined) attachment?.writes.set(String(event['toolCallId']), { path: written, turnId });
      const read = readPath(event['display']);
      if (read !== undefined) attachment?.reads.add(read);
      if (read !== undefined && requireTask(await requireDoc(this.store, workspaceId), taskId).kind === 'init') {
        const doc = await requireDoc(this.store, workspaceId);
        const rel = this.relativeToRoot(doc.root, read);
        await patchTask(this.store, workspaceId, taskId, (current) => ((current.sources ?? []).includes(rel) ? current : { ...current, sources: [...(current.sources ?? []), rel].slice(0, 40) }));
      }
      await patchTask(this.store, workspaceId, taskId, (current) => ({ ...current, phase: phaseOf(typeof event['name'] === 'string' ? event['name'] : '', read ?? written) }));
      return;
    }
    if (type === 'tool.result') {
      if (event['isError'] === true) attachment?.writes.delete(String(event['toolCallId']));
      return;
    }
    if (type === 'turn.ended') {
      await this.finishTurn(workspaceId, taskId, String(event['reason']), event['error'] as TurnError | undefined);
    }
  }

  private async finishTurn(workspaceId: string, taskId: string, reason: string, error: TurnError | undefined): Promise<void> {
    await this.settleTurn(workspaceId, taskId, reason, error);
    await writePlanFiles(this.store, workspaceId, taskId);
    await writeWorkLog(this.store, workspaceId, taskId);
    const doc = await requireDoc(this.store, workspaceId);
    const queued = doc.decisions.find((decision) => decision.taskId === taskId && isExploring(decision) && decision.exploration!.angles.every((angle) => angle.status === 'queued'));
    if (queued !== undefined && requireTask(doc, taskId).status === 'running') {
      await this.decisions.startExploration(workspaceId, queued.decisionId);
      return;
    }
    if (queued !== undefined) await this.decisions.finishExploration(workspaceId, queued.decisionId, undefined);
    await takeSnapshot(this.store, workspaceId, taskId);
  }

  private async settleTurn(workspaceId: string, taskId: string, reason: string, error: TurnError | undefined): Promise<void> {
    const doc = await requireDoc(this.store, workspaceId);
    const task = requireTask(doc, taskId);
    const endedAt = new Date().toISOString();
    const root = rootOfTask(doc, task);
    if (task.kind === 'user') await this.recordRound(workspaceId, taskId, root, endedAt);
    if (reason === 'cancelled') {
      const status: TaskStatus = task.pauseRequested ? 'paused' : 'interrupted';
      await patchTask(this.store, workspaceId, taskId, (current) => toEnded(current, status, endedAt));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'stopped', endedAt } }));
      return;
    }
    if (reason === 'failed' || reason === 'blocked') {
      await patchTask(this.store, workspaceId, taskId, (current) => ({ ...toEnded(current, 'failed', endedAt), error: taskErrorOf(error, reason, endedAt) }));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'failed', endedAt } }));
      return;
    }
    if (task.kind === 'init') {
      await this.store.update(workspaceId, (current) => patchTaskIn({
        ...current,
        init: { ...current.init, status: current.scan?.truncated === true ? 'partial' : 'completed', endedAt },
        todos: suggestedTodos(current, taskId, current.understanding?.suggestions ?? [], endedAt),
      }, taskId, (candidate) => toEnded(candidate, 'completed', endedAt)));
      return;
    }
    const settled = await requireDoc(this.store, workspaceId);
    const line = trajectoryOfSession(settled, task.sessionId);
    const open = line === undefined ? undefined : openDecisionOf(settled, line, taskId);
    const attachment = this.workers.attachmentOf(taskId);
    const fullReply = (attachment?.reply ?? '').trim();
    const reply = fullReply.slice(0, 4000);
    if (open !== undefined) {
      const exploring = isExploring(open);
      await patchTask(this.store, workspaceId, taskId, (current) => {
        const replied = { ...current, lastReply: reply === '' ? current.lastReply : reply };
        return exploring
          ? { ...replied, status: 'running', pendingInteraction: 'none', phase: `正在分头写 ${open.exploration!.angles.length} 个方案` }
          : toAwaiting(replied, 'choice', '等你选方案');
      });
      return;
    }
    await patchTask(this.store, workspaceId, taskId, (current) => ({ ...current, status: 'verifying', phase: '核验交付' }));
    const current = requireTask(await requireDoc(this.store, workspaceId), taskId);
    const notes: string[] = [];
    const observedWrites = new Map<string, number | undefined>();
    for (const item of attachment?.writes.values() ?? []) observedWrites.set(this.relativeToRoot(root, item.path), item.turnId);
    const observed = [...observedWrites.keys()];
    let report = current.report;
    if (report === undefined && observed.length > 0) {
      report = { summary: '产物由实际写入的文件推断得出；Agent 这次没有上报。', deliverables: observed.map((path) => ({ path, note: '实际写入', turnId: observedWrites.get(path) })), unresolved: [], reportedAt: endedAt };
      notes.push('agent did not report; deliverables inferred from observed writes');
    } else if (report === undefined) {
      const lastReply = reply === '' ? undefined : reply;
      await patchTask(this.store, workspaceId, taskId, (candidate) => (asksUser(fullReply)
        ? { ...toAwaiting(candidate, 'reply', '已回复，等你确认或继续'), lastReply, verification: ['no files written and no result report; the reply asks the user something, waiting for them'] }
        : { ...toEnded(candidate, 'completed', endedAt), lastReply, verification: ['no files written and no result report; the agent answered'] }));
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
    const deliverables = await Promise.all(report.deliverables.map(async (item) => ({ ...item, exists: await this.exists(root, item.path) })));
    for (const item of deliverables) if (item.exists === false) notes.push(`reported file missing: ${item.path}`);
    for (const item of report.unresolved) notes.push(`unresolved: ${item}`);
    const missing = deliverables.some((item) => item.exists === false);
    const status: TaskStatus = missing || report.unresolved.length > 0 ? 'needs_review' : 'completed';
    const finalReport = { ...report, deliverables };
    await patchTask(this.store, workspaceId, taskId, (candidate) => ({
      ...toEnded(candidate, status, endedAt),
      verification: notes,
      report: finalReport,
      lastReply: reply === '' ? candidate.lastReply : reply,
    }));
    const nextStep = finalReport.nextStep;
    if (nextStep !== undefined) await this.store.update(workspaceId, (current) => ({ ...current, todos: suggestedTodos(current, taskId, [nextStep], endedAt) }));
  }

  private async recordRound(workspaceId: string, taskId: string, root: string, at: string): Promise<void> {
    const attachment = this.workers.attachmentOf(taskId);
    if (attachment === undefined) return;
    const reads = [...new Set([...attachment.reads].map((path) => this.relativeToRoot(root, path)))].slice(0, 20);
    const writes = [...new Set([...attachment.writes.values()].map((item) => this.relativeToRoot(root, item.path)))].slice(0, 20);
    const round: TaskRound = { at, prompt: attachment.prompt.slice(0, 400), reads, writes, reply: attachment.reply.trim().slice(0, 600), turnIndex: attachment.turnIndex };
    attachment.prompt = '';
    if (round.prompt === '' && round.reply === '' && reads.length === 0 && writes.length === 0) return;
    await patchTask(this.store, workspaceId, taskId, (current) => ({
      ...current,
      rounds: [...(current.rounds ?? []), round].slice(-20),
      sources: [...new Set([...(current.sources ?? []), ...reads])].slice(0, 40),
    }));
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
}
