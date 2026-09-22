import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
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
  type ContextEntry,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
  type TaskStatus,
  type TaskTrigger,
} from '@moonshot-ai/agent-core-v2';
import { ulid } from 'ulid';

import { ensureMainAgent } from '../transport/mainAgent';
import { ContinuoError } from './errors';
import { renderScanForPrompt, scanFingerprint, scanWorkspace } from './scan';

export { ContinuoError } from './errors';

interface Attachment {
  readonly dispose: () => void;
  readonly writes: Map<string, { path: string; turnId?: number }>;
  readonly reads: Set<string>;
  reply: string;
}

const INIT_STEP_BUDGET = 8;

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
      activity: [...current.activity, { at: new Date().toISOString(), kind: 'system', text: current.openCount === 0 ? '第一次打开这个文件夹' : '重新打开这个文件夹' }],
    }));
    doc = await this.refreshSourceFingerprints(workspaceId);
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

  async reunderstand(workspaceId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    if (doc.init.status === 'running' && this.isLive(doc.init.taskId, doc)) return doc;
    const running = doc.tasks.find((task) => task.kind === 'user' && (task.status === 'running' || task.status === 'verifying' || task.status === 'queued'));
    if (running !== undefined) throw new ContinuoError('invalid_state', `task ${running.taskId} is still ${running.status}; wait for it before re-reading the folder`);
    return this.startInit(doc);
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
    const session = await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir: doc.root, mainAgentBinding: { profile: CONTINUO_WORKER_PROFILE } });
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
      activity: [...current.activity, { at: now, taskId, kind: 'task', text: `新任务：${task.title}` }],
    }));
    this.attach(workspaceId, taskId, session, agent);
    const promptId = this.submitPrompt(agent, text);
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
    const promptId = this.submitPrompt(agent, `Continue the task: "${task.title}". ${reason} First check what already exists in the workspace so you do not redo finished work, then finish the remaining part. Call ReportWorkspaceResult before your final answer.`);
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
    const promptId = this.submitPrompt(agent, text);
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, trigger: 'reply' as TaskTrigger, promptIds: [...current.promptIds, promptId], supplements: [...(current.supplements ?? []), text], endedAt: undefined, verification: undefined }), { activity: `你补充了要求：${text.length > 60 ? `${text.slice(0, 60)}…` : text}` });
  }

  async complete(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (!(task.status === 'awaiting_user' && task.pendingInteraction === 'reply') && task.status !== 'needs_review') {
      throw new ContinuoError('invalid_state', `task ${taskId} is ${task.status}; only tasks waiting for your reply or review can be marked done`);
    }
    const endedAt = new Date().toISOString();
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'completed', pendingInteraction: 'none', phase: undefined, endedAt }), { activity: '你把这个任务标记为完成' });
  }

  async updateContextEntry(workspaceId: string, entryId: string, patch: { text?: string; status?: 'active' | 'inactive'; expectedRevision: number }): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const entry = doc.context.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw new ContinuoError('entry_not_found', `context entry ${entryId} does not exist`);
    if (entry.revision !== patch.expectedRevision) throw new ContinuoError('revision_conflict', `entry ${entryId} is at revision ${entry.revision}, not ${patch.expectedRevision}`);
    const now = new Date().toISOString();
    return this.store.update(workspaceId, (current) => {
      const context = [...current.context];
      const index = context.findIndex((candidate) => candidate.id === entryId);
      const old = context[index]!;
      if (patch.text !== undefined && patch.text !== old.text) {
        context[index] = { ...old, status: 'superseded', updatedAt: now };
        context.push({ ...old, id: `ctx_${randomUUID().slice(0, 8)}`, text: patch.text, origin: 'user', status: 'active', revision: 1, supersedes: old.id, sourceRefs: [...old.sourceRefs, 'user: edited in Continuo'], createdAt: now, updatedAt: now });
      } else if (patch.status !== undefined) {
        context[index] = { ...old, status: patch.status, origin: patch.status === 'active' ? 'user' : old.origin, revision: old.revision + 1, updatedAt: now };
      }
      return {
        ...current,
        context,
        activity: [...current.activity, { at: now, kind: 'user', text: patch.text !== undefined ? `你改了一条记住的事：${patch.text}` : patch.status === 'active' ? '你确认了一条记住的事' : '你停用了一条记住的事' }],
      };
    });
  }

  async workLog(workspaceId: string): Promise<string> {
    const doc = await this.requireDoc(workspaceId);
    const byDay = new Map<string, Array<{ at: string; text: string }>>();
    for (const entry of doc.activity) {
      const day = entry.at.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push({ at: entry.at, text: entry.text });
      byDay.set(day, list);
    }
    const lines: string[] = [];
    for (const [day, items] of [...byDay.entries()].toReversed()) {
      lines.push(`## ${day}`, '');
      for (const item of items) lines.push(`- ${item.at.slice(11, 16)} ${item.text}`);
      lines.push('');
    }
    if (lines.length === 0) lines.push('还没有工作记录。');
    return lines.join('\n');
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
    const fingerprint = scanFingerprint(scan);
    const now = new Date().toISOString();
    const taskId = `task_${randomUUID().slice(0, 8)}`;
    if (scan.entries.length === 0) {
      return this.store.update(workspaceId, (current) => ({
        ...current,
        scan,
        init: { status: 'completed', fingerprint, startedAt: now, endedAt: now },
        understanding: { text: '这个文件夹是空的。工作空间已就绪，等待第一个任务；不对它的用途做任何假设。', sourceRefs: [], updatedAt: now },
        activity: [...current.activity, { at: now, kind: 'system', text: '空文件夹：不需要了解，等你交代第一件事' }],
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
      init: { status: 'running', fingerprint, taskId, startedAt: now },
      tasks: [...current.tasks, task],
      activity: [...current.activity, { at: now, taskId, kind: 'task', text: '开始了解这个文件夹' }],
    }));
    this.attach(workspaceId, taskId, session, agent);
    const prompt = [
      'A user just opened this folder in Continuo. Understand how it is organized and record your understanding with the WorkspaceContext tool, following your instructions.',
      'Write the understanding and every entry in the language the workspace documents themselves use (for example Chinese when the guide file is in Chinese).',
      `Budget: read at most 8 files, prefer guide files, stop after about ${INIT_STEP_BUDGET} steps or as soon as the purpose, key materials and conventions are clear, and say clearly which parts you did not read.`,
      '',
      renderScanForPrompt(scan, doc.root),
    ].join('\n');
    const promptId = this.submitPrompt(agent, prompt);
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', promptIds: [promptId] }));
  }

  private submitPrompt(agent: IAgentScopeHandle, text: string): string {
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
      }, { silent: true });
    });
    this.attachments.set(taskId, { dispose: () => { onEvent.dispose(); onActivity.dispose(); }, writes: new Map(), reads: new Set(), reply: '' });
  }

  private async onAgentEvent(workspaceId: string, taskId: string, event: Record<string, unknown>): Promise<void> {
    const type = event['type'];
    if (type === 'turn.started') {
      const attachment = this.attachments.get(taskId);
      if (attachment !== undefined) { attachment.reply = ''; attachment.writes.clear(); }
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
      }), { silent: true });
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
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, phase: description }), { silent: true });
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
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    const endedAt = new Date().toISOString();
    if (reason === 'cancelled') {
      const status: TaskStatus = task.pauseRequested ? 'paused' : 'interrupted';
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status, phase: undefined, pendingInteraction: 'none', endedAt }), { activity: status === 'paused' ? '你暂停了这个任务' : '这一轮被中断' });
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'stopped', endedAt } }));
      return;
    }
    if (reason === 'failed' || reason === 'blocked') {
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'failed', phase: undefined, pendingInteraction: 'none', lastError: errorMessage ?? reason, endedAt }), { activity: `这次没能完成：${errorMessage ?? reason}` });
      if (task.kind === 'init') await this.store.update(workspaceId, (current) => ({ ...current, init: { ...current.init, status: 'failed', endedAt } }));
      return;
    }
    if (task.kind === 'init') {
      await this.store.update(workspaceId, (current) => ({
        ...current,
        init: { ...current.init, status: current.scan?.truncated === true ? 'partial' : 'completed', endedAt },
        tasks: current.tasks.map((candidate) => (candidate.taskId === taskId ? { ...candidate, status: 'completed' as TaskStatus, phase: undefined, endedAt, updatedAt: endedAt } : candidate)),
        activity: [...current.activity, { at: endedAt, taskId, kind: 'task', text: current.understanding === undefined ? '了解结束，但没有形成理解' : '了解完成' }],
      }));
      return;
    }
    await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'verifying', phase: '核验交付' }), { silent: true });
    const fresh = await this.requireDoc(workspaceId);
    const current = this.requireTask(fresh, taskId);
    const notes: string[] = [];
    const observedWrites = new Map<string, number | undefined>();
    for (const item of this.attachments.get(taskId)?.writes.values() ?? []) observedWrites.set(this.relativeToRoot(fresh.root, item.path), item.turnId);
    const observed = [...observedWrites.keys()];
    const sources = [...new Set([...(current.sources ?? []), ...[...(this.attachments.get(taskId)?.reads ?? [])].map((path) => this.relativeToRoot(fresh.root, path))])].slice(0, 40);
    let report = current.report;
    if (report === undefined && observed.length > 0) {
      report = { summary: '产物由实际写入的文件推断得出；Agent 这次没有上报。', deliverables: observed.map((path) => ({ path, note: '实际写入', turnId: observedWrites.get(path) })), unresolved: [], reportedAt: endedAt };
      notes.push('agent did not report; deliverables inferred from observed writes');
    } else if (report === undefined) {
      const reply = (this.attachments.get(taskId)?.reply ?? '').trim().slice(0, 4000);
      await this.store.update(workspaceId, (doc2) => ({
        ...doc2,
        tasks: doc2.tasks.map((candidate) => candidate.taskId === taskId
          ? { ...candidate, status: 'awaiting_user' as TaskStatus, pendingInteraction: 'reply' as const, phase: '已回复，等你确认或继续', lastReply: reply === '' ? undefined : reply, verification: ['no files written and no result report; the agent replied and is waiting for you'], updatedAt: endedAt }
          : candidate),
        activity: [...doc2.activity, { at: endedAt, taskId, kind: 'task' as const, text: '它回复了你，没有改动文件，在等你回话' }],
      }));
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
    const progress = this.progressEntry(current, status, deliverables, endedAt);
    await this.store.update(workspaceId, (doc2) => ({
      ...doc2,
      tasks: doc2.tasks.map((candidate) => candidate.taskId === taskId
        ? { ...candidate, status, phase: undefined, pendingInteraction: 'none', verification: notes, report: finalReport, sources, lastReply: lastReply === '' ? candidate.lastReply : lastReply, endedAt, updatedAt: endedAt }
        : candidate),
      context: progress === undefined ? doc2.context : [...doc2.context, progress],
      activity: [
        ...doc2.activity,
        { at: endedAt, taskId, kind: 'task' as const, text: status === 'completed' ? `任务完成：${deliverables.length} 份产物已核对` : `还差一点：${notes.join('；')}` },
        ...(progress === undefined ? [] : [{ at: endedAt, taskId, kind: 'context' as const, text: `记下一条进度：${progress.text}` }]),
      ],
    }));
    await this.refreshSourceFingerprints(workspaceId);
  }

  private progressEntry(task: ContinuoTask, status: TaskStatus, deliverables: ReadonlyArray<{ path: string; exists?: boolean }>, at: string): ContextEntry | undefined {
    const existing = deliverables.filter((item) => item.exists !== false).map((item) => item.path);
    if (existing.length === 0 && status === 'completed') return undefined;
    const text = status === 'completed'
      ? `任务「${task.title}」已完成，产物：${existing.join('、')}。`
      : `任务「${task.title}」还差一点${existing.length > 0 ? `，已有产物：${existing.join('、')}` : ''}。`;
    return { id: `ctx_${randomUUID().slice(0, 8)}`, kind: 'progress', text, scope: { type: 'workspace' }, sourceRefs: [`task:${task.taskId}`, ...existing], origin: 'agent', status: 'active', revision: 1, taskId: task.taskId, createdAt: at, updatedAt: at };
  }

  private async refreshSourceFingerprints(workspaceId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const prints = new Map<string, string | undefined>();
    for (const entry of doc.context) {
      if (entry.status !== 'active' && entry.status !== 'candidate') continue;
      const files = entry.sourceRefs.filter((ref) => !ref.includes(':') || isAbsolute(ref));
      if (files.length === 0) continue;
      prints.set(entry.id, await this.fingerprintFiles(doc.root, files));
    }
    if (prints.size === 0) return doc;
    const now = new Date().toISOString();
    return this.store.update(workspaceId, (current) => {
      const stale: string[] = [];
      const context = current.context.map((entry) => {
        const print = prints.get(entry.id);
        if (print === undefined) return entry;
        if (entry.sourceFingerprint === undefined) return { ...entry, sourceFingerprint: print };
        if (entry.sourceFingerprint === print || entry.status !== 'active') return entry;
        stale.push(entry.text.slice(0, 60));
        return { ...entry, status: 'stale' as const, sourceFingerprint: print, revision: entry.revision + 1, updatedAt: now };
      });
      if (stale.length === 0 && context.every((entry, index) => entry === current.context[index])) return current;
      return { ...current, context, activity: stale.length === 0 ? current.activity : [...current.activity, ...stale.map((text) => ({ at: now, kind: 'context' as const, text: `来源变了，暂时不用这条：${text}` }))] };
    });
  }

  private async fingerprintFiles(root: string, files: readonly string[]): Promise<string> {
    const hash = createHash('sha1');
    for (const file of files) {
      const abs = isAbsolute(file) ? file : resolve(root, file);
      try {
        const info = await stat(abs);
        hash.update(`${file}:${info.size}:${info.mtimeMs}\n`);
      } catch {
        hash.update(`${file}:missing\n`);
      }
    }
    return hash.digest('hex').slice(0, 16);
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

  private async patchTask(workspaceId: string, taskId: string, mutate: (task: ContinuoTask) => ContinuoTask, options: { silent?: boolean; activity?: string } = {}): Promise<ContinuoWorkspaceDoc> {
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
      const activity = options.activity === undefined ? current.activity : [...current.activity, { at: now, taskId, kind: 'tool' as const, text: options.activity }];
      return { ...current, tasks, activity };
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
