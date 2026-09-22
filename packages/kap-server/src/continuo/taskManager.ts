import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

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
  getLiveSessionById,
  resumeSessionById,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
  type TaskRound,
  type TaskStatus,
  type TaskTrigger,
} from '@moonshot-ai/agent-core-v2';
import { ulid } from 'ulid';

import { ensureMainAgent } from '../transport/mainAgent';
import { ContinuoError } from './errors';
import { renderScanForPrompt, scanWorkspace } from './scan';

export { ContinuoError } from './errors';

interface Attachment {
  readonly dispose: () => void;
  readonly writes: Map<string, { path: string; turnId?: number }>;
  readonly sessionId: string;
  readonly reads: Set<string>;
  reply: string;
  prompt: string;
}

const INIT_STEP_BUDGET = 8;
const WORK_LOG_DIR = 'work-log';
const MAX_WORK_LOG_FILES = 60;

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
  private readonly requests = new Map<string, string>();
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
    if (workspace === undefined) throw new ContinuoError('workspace_not_found', `workspace ${workspaceId} does not exist`);
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
    if (doc.init.status === 'pending' || doc.init.status === 'failed' || doc.init.status === 'stopped') {
      doc = await this.startInit(doc);
    } else if (doc.init.status === 'running' && !this.isLive(doc.init.taskId, doc)) {
      doc = await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: current.understanding === undefined ? 'partial' : 'completed', endedAt: new Date().toISOString() } }));
    }
    return doc;
  }

  async snapshot(workspaceId: string): Promise<ContinuoWorkspaceDoc | undefined> {
    return this.store.load(workspaceId);
  }

  async createUserTask(workspaceId: string, text: string, clientRequestId?: string): Promise<{ doc: ContinuoWorkspaceDoc; task: ContinuoTask }> {
    const doc = await this.requireDoc(workspaceId);
    if (clientRequestId !== undefined) {
      const known = this.requests.get(`task:${workspaceId}:${clientRequestId}`);
      const existing = known === undefined ? undefined : doc.tasks.find((task) => task.taskId === known);
      if (existing !== undefined) return { doc, task: existing };
    }
    const running = doc.tasks.find((task) => task.kind === 'user' && (task.status === 'running' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply') || task.status === 'verifying'));
    if (running !== undefined) {
      throw new ContinuoError('invalid_state', `task ${running.taskId} is still ${running.status}; one task runs at a time`);
    }
    const prior = doc.tasks.findLast((task) => task.kind === 'user' && task.sessionId !== '');
    const session = (prior === undefined ? undefined : await resumeSessionById(this.core.accessor, prior.sessionId))
      ?? await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir: doc.root, mainAgentBinding: { profile: CONTINUO_WORKER_PROFILE } });
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
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
    }));
    this.attach(workspaceId, taskId, session, agent);
    const promptId = this.submitPrompt(agent, taskId, text);
    const updated = await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [...current.promptIds, promptId] }));
    return { doc: updated, task: updated.tasks.find((candidate) => candidate.taskId === taskId)! };
  }

  async pause(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.status !== 'running' && task.status !== 'awaiting_user' && task.status !== 'queued') return doc;
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, pauseRequested: true }));
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session !== undefined) {
      const agent = await ensureMainAgent(session);
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
      throw new ContinuoError('invalid_state', `task ${taskId} is ${task.status}; only paused, interrupted, failed or needs_review tasks resume`);
    }
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', `session ${task.sessionId} for task ${taskId} is gone`);
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
    this.attach(workspaceId, taskId, session, agent);
    const reason = task.status === 'needs_review' && task.verification !== undefined
      ? `Review notes: ${task.verification.join('; ')}`
      : task.status === 'failed'
        ? `The previous attempt failed (${task.lastError ?? 'unknown error'}).`
        : 'The task was paused or interrupted.';
    const promptId = this.submitPrompt(agent, taskId, `Continue the task: "${task.title}". ${reason} First check what already exists in the workspace so you do not redo finished work, then finish the remaining part. Call ReportWorkspaceResult before your final answer.`, '继续这个任务');
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pauseRequested: false, trigger: 'resume' as TaskTrigger, promptIds: [...current.promptIds, promptId], endedAt: undefined, verification: undefined, lastError: undefined }));
  }

  async reply(workspaceId: string, taskId: string, text: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.kind !== 'user') throw new ContinuoError('invalid_state', 'only user tasks accept replies');
    if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply')) {
      throw new ContinuoError('invalid_state', `task ${taskId} is ${task.status}; answer its pending interaction or stop it first`);
    }
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', `session ${task.sessionId} for task ${taskId} is gone`);
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
    this.attach(workspaceId, taskId, session, agent);
    const promptId = this.submitPrompt(agent, taskId, text);
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, trigger: 'reply' as TaskTrigger, promptIds: [...current.promptIds, promptId], supplements: [...(current.supplements ?? []), text], endedAt: undefined, verification: undefined }));
  }

  async workLog(workspaceId: string): Promise<string> {
    const doc = await this.requireDoc(workspaceId);
    const dir = resolve(doc.root, WORK_LOG_DIR);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.md'));
    } catch {
      return '还没有工作记录。任务做完后，这里会列出项目里 work-log/ 下的日志。';
    }
    if (names.length === 0) return '还没有工作记录。任务做完后，这里会列出项目里 work-log/ 下的日志。';
    const dated = await Promise.all(names.map(async (name) => {
      const info = await stat(resolve(dir, name)).catch(() => undefined);
      return { name, at: info?.mtimeMs ?? 0 };
    }));
    const ordered = dated.toSorted((a, b) => b.at - a.at).slice(0, MAX_WORK_LOG_FILES);
    const parts = await Promise.all(ordered.map((item) => readFile(resolve(dir, item.name), 'utf8').catch(() => '')));
    return parts.filter((part) => part.trim().length > 0).join('\n\n---\n\n');
  }

  private reconcileOnOpen(task: ContinuoTask): ContinuoTask {
    if ((task.status === 'running' || task.status === 'awaiting_user' || task.status === 'verifying' || task.status === 'queued') && !this.attachments.has(task.taskId)) {
      return { ...task, status: 'interrupted', lastError: 'server restarted while the task was active', updatedAt: new Date().toISOString(), endedAt: new Date().toISOString() };
    }
    return task;
  }

  private isLive(taskId: string | undefined, doc: ContinuoWorkspaceDoc): boolean {
    if (taskId === undefined) return false;
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    return task !== undefined && this.attachments.has(taskId) && getLiveSessionById(this.core.accessor, task.sessionId) !== undefined;
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
        understanding: { text: '这个文件夹是空的。等你放进材料或交代第一件事；下次打开会重新了解一遍。', sourceRefs: [], updatedAt: now },
      }));
    }
    const session = await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir: doc.root, mainAgentBinding: { profile: CONTINUO_INIT_PROFILE } });
    const agent = await ensureMainAgent(session);
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
      `Budget: read at most 8 files, prefer guide files, stop after about ${INIT_STEP_BUDGET} steps or as soon as the purpose, key materials and conventions are clear, and say clearly which parts you did not read.`,
      '',
      renderScanForPrompt(scan, doc.root),
    ].join('\n');
    const promptId = this.submitPrompt(agent, taskId, prompt, '');
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [promptId] }));
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
      const description = typeof event['description'] === 'string' ? event['description'] : typeof event['name'] === 'string' ? event['name'] : 'tool';
      const attachment = this.attachments.get(taskId);
      const turnId = typeof event['turnId'] === 'number' ? event['turnId'] : undefined;
      const written = writtenPath(event['display']);
      if (written !== undefined) attachment?.writes.set(String(event['toolCallId']), { path: written, turnId });
      const read = readPath(event['display']);
      if (read !== undefined) attachment?.reads.add(read);
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, phase: description }));
      return;
    }
    if (type === 'tool.result') {
      if (event['isError'] === true) this.attachments.get(taskId)?.writes.delete(String(event['toolCallId']));
      return;
    }
    if (type === 'turn.ended') {
      const reason = String(event['reason']);
      const error = event['error'] as { message?: string } | undefined;
      await this.finishTurn(workspaceId, taskId, reason, error?.message);
    }
  }

  private async finishTurn(workspaceId: string, taskId: string, reason: string, errorMessage: string | undefined): Promise<void> {
    await this.settleTurn(workspaceId, taskId, reason, errorMessage);
    await this.writeWorkLog(workspaceId, taskId);
  }

  private async settleTurn(workspaceId: string, taskId: string, reason: string, errorMessage: string | undefined): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    const endedAt = new Date().toISOString();
    if (task.kind === 'user') await this.recordRound(workspaceId, taskId, doc.root, endedAt);
    if (reason === 'cancelled') {
      const status: TaskStatus = task.pauseRequested ? 'paused' : 'interrupted';
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status, phase: undefined, pendingInteraction: 'none', endedAt }));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'stopped', endedAt } }));
      return;
    }
    if (reason === 'failed' || reason === 'blocked') {
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'failed', phase: undefined, pendingInteraction: 'none', lastError: errorMessage ?? reason, endedAt }));
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'failed', endedAt } }));
      return;
    }
    if (task.kind === 'init') {
      await this.store.update(workspaceId, (current) => ({
        ...current,
        init: { ...current.init, status: current.scan?.truncated === true ? 'partial' : 'completed', endedAt },
        tasks: current.tasks.map((candidate) => (candidate.taskId === taskId ? { ...candidate, status: 'completed' as TaskStatus, phase: undefined, endedAt, updatedAt: endedAt } : candidate)),
      }));
      return;
    }
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'verifying', phase: '核验交付' }));
    const fresh = await this.requireDoc(workspaceId);
    const current = this.requireTask(fresh, taskId);
    const notes: string[] = [];
    const observedWrites = new Map<string, number | undefined>();
    for (const item of this.attachments.get(taskId)?.writes.values() ?? []) observedWrites.set(this.relativeToRoot(fresh.root, item.path), item.turnId);
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
        const rel = this.relativeToRoot(fresh.root, item.path);
        return observedWrites.has(rel) ? { ...item, path: rel, turnId: observedWrites.get(rel) } : item;
      }) };
      const reported = new Set(report.deliverables.map((item) => this.relativeToRoot(fresh.root, item.path)));
      const unreported = observed.filter((path) => !reported.has(path));
      if (unreported.length > 0) {
        report = { ...report, deliverables: [...report.deliverables, ...unreported.map((path) => ({ path, note: '写了但没上报', turnId: observedWrites.get(path) }))] };
        notes.push(`written but not reported: ${unreported.join(', ')}`);
      }
    }
    let deliverables = report?.deliverables ?? [];
    if (report !== undefined) {
      deliverables = await Promise.all(deliverables.map(async (item) => ({ ...item, exists: await this.exists(fresh.root, item.path) })));
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
  }

  private async recordRound(workspaceId: string, taskId: string, root: string, at: string): Promise<void> {
    const attachment = this.attachments.get(taskId);
    if (attachment === undefined) return;
    const reads = [...new Set([...attachment.reads].map((path) => this.relativeToRoot(root, path)))].slice(0, 20);
    const writes = [...new Set([...attachment.writes.values()].map((item) => this.relativeToRoot(root, item.path)))].slice(0, 20);
    const round: TaskRound = { at, prompt: attachment.prompt.slice(0, 400), reads, writes, reply: attachment.reply.trim().slice(0, 600) };
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
    const dir = resolve(doc.root, WORK_LOG_DIR);
    try {
      await mkdir(dir, { recursive: true });
      const path = await this.logPathFor(dir, task);
      if (task.logPath !== undefined && task.logPath !== path) {
        await rename(resolve(doc.root, task.logPath), resolve(doc.root, path)).catch(() => undefined);
      }
      await writeFile(resolve(doc.root, path), renderWorkLog(doc, task), 'utf8');
      if (task.logPath !== path) await this.patchTask(workspaceId, taskId, (current) => ({ ...current, logPath: path }));
    } catch {
      return;
    }
  }

  private async logPathFor(dir: string, task: ContinuoTask): Promise<string> {
    const day = (task.endedAt ?? task.createdAt).slice(0, 10);
    const base = ['work-log', day, taskCategory(task), logSlug(taskName(task))].filter((part) => part !== undefined && part !== '').join('-');
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
    if (doc === undefined) throw new ContinuoError('workspace_not_found', `workspace ${workspaceId} has not been opened in Continuo`);
    return doc;
  }

  private requireTask(doc: ContinuoWorkspaceDoc, taskId: string): ContinuoTask {
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) throw new ContinuoError('task_not_found', `task ${taskId} does not exist`);
    return task;
  }
}

const DONE = new Set<TaskStatus>(['completed', 'needs_review']);

function taskName(task: ContinuoTask): string {
  if (task.kind === 'init') return '了解项目';
  if (task.name !== undefined && task.name.trim() !== '') return task.name.trim();
  const head = (task.title.split(/[\n，。,.；;!?！？]/)[0] ?? '').trim();
  return head === '' ? '任务' : head.slice(0, 12);
}

function taskCategory(task: ContinuoTask): string | undefined {
  return task.kind === 'init' ? 'init' : task.category;
}

function logSlug(name: string): string {
  const cleaned = name.replaceAll(/[\\/:*?"<>|]/g, '').replaceAll(/\s+/g, '-').slice(0, 20).replaceAll(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? 'task' : cleaned;
}

function stamp(iso: string | undefined): string {
  return iso === undefined ? '' : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function oneLine(text: string, max: number): string {
  const line = text.split('\n').map((part) => part.trim()).filter((part) => part !== '').join(' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
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
      ].filter((part) => part !== '').join('');
  const deliverables = task.report?.deliverables ?? [];
  const missing = deliverables.filter((item) => item.exists === false).length;
  const result = pending
    ? '⏳ 待阶段完成'
    : [
        task.report === undefined ? '' : oneLine(task.report.summary, 300),
        deliverables.length === 0 ? '' : `产物 ${deliverables.length} 份，${missing === 0 ? '已逐个核对存在' : `其中 ${missing} 份没找到`}。`,
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
  lines.push(`| 输入目录 | ${doc.root} |`);
  lines.push(`| 输入文件 | ${sources.length === 0 ? '—' : sources.join(', ')} |`);
  lines.push(`| 输出文件 | ${deliverables.length === 0 ? '—' : deliverables.map((item) => item.path).join(', ')} |`);
  lines.push('', '### 原始任务描述', '', `> ${oneLine(rounds[0]?.prompt ?? task.title, 600)}`);
  if (rounds.length > 0) {
    lines.push('', '### 工作记录');
    for (const [index, round] of rounds.entries()) {
      const label = index === 0 ? taskName(task) : oneLine(round.prompt, 16);
      lines.push('', `#### [${round.at.slice(11, 16)}] 对话 ${index + 1} - ${label === '' ? '继续' : label}`);
      lines.push(`**输入**: ${index === 0 ? '同原始任务描述' : oneLine(round.prompt, 200)}`);
      const handled = [round.reads.length === 0 ? '' : `读 ${round.reads.join('、')}`, oneLine(round.reply, 200)].filter((part) => part !== '');
      lines.push(`**处理**: ${handled.length === 0 ? '—' : handled.join('；')}`);
      lines.push(`**产出**: ${round.writes.length === 0 ? '无文件产出' : round.writes.join('、')}`);
    }
  }
  if (deliverables.length > 0) {
    lines.push('', '### 最终产出', '', '| 文件 | 说明 | 状态 |', '|------|------|------|');
    for (const item of deliverables) lines.push(`| ${item.path} | ${item.note === undefined || item.note === '' ? '—' : item.note} | ${item.exists === false ? '❌ 没找到' : '✅'} |`);
  }
  const notes = [
    ...(task.report?.unresolved ?? []).map((item) => `- 未完成：${item}`),
    ...(task.report?.nextStep === undefined ? [] : [`- 建议的下一步：${task.report.nextStep.title}——${task.report.nextStep.reason}`]),
  ];
  if (notes.length > 0) lines.push('', '### 备注', '', ...notes);
  return lines;
}
