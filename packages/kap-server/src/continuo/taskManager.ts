import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
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
  WORK_LOG_DIR,
  choiceOn,
  currentTrajectory,
  getLiveSessionById,
  inheritedChoices,
  lastTurnOf,
  localDay,
  localTime,
  logSlug,
  openDecisionOf,
  planStatusOn,
  resumeSessionById,
  taskCategory,
  taskName,
  tasksThrough,
  trajectoryOfSession,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type Decision,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
  type TaskRound,
  type TaskStatus,
  type TaskTrigger,
  type Trajectory,
  type TrajectoryOrigin,
  type TrajectoryPlan,
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
  turnIndex?: number;
}

const INIT_STEP_BUDGET = 8;
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
    const line = currentTrajectory(doc);
    const session = line === undefined
      ? await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir: doc.root, mainAgentBinding: { profile: CONTINUO_WORKER_PROFILE } })
      : await resumeSessionById(this.core.accessor, line.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', `the session of the current line is gone`);
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
    const reason = task.status === 'needs_review'
      ? `上次核对时还差一点${(task.report?.unresolved ?? []).length > 0 ? `：${(task.report?.unresolved ?? []).join('；')}` : ''}。`
      : task.status === 'failed'
        ? `上次没做完${task.lastError === undefined ? '' : `（${task.lastError.slice(0, 120)}）`}。`
        : '上次停在了半路。';
    const promptId = await this.sendTurn(workspaceId, taskId, agent, `继续「${taskName(task)}」。${reason}先看看项目里已经有什么，别重做做完的部分，把剩下的做完。`, '继续这件事');
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pauseRequested: false, trigger: 'resume' as TaskTrigger, promptIds: [...current.promptIds, promptId], endedAt: undefined, verification: undefined, lastError: undefined }));
  }

  async reply(workspaceId: string, taskId: string, text: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const task = this.requireTask(doc, taskId);
    if (task.kind !== 'user') throw new ContinuoError('invalid_state', 'only user tasks accept replies');
    if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply' && task.pendingInteraction !== 'choice')) {
      throw new ContinuoError('invalid_state', `task ${taskId} is ${task.status}; answer its pending interaction or stop it first`);
    }
    const line = trajectoryOfSession(doc, task.sessionId);
    const open = line === undefined || task.pendingInteraction !== 'choice' ? undefined : openDecisionOf(doc, line, taskId);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', `session ${task.sessionId} for task ${taskId} is gone`);
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
    this.attach(workspaceId, taskId, session, agent);
    if (line !== undefined && open !== undefined) {
      const at = new Date().toISOString();
      await this.store.update(workspaceId, (current) => ({
        ...current,
        trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === line.trajectoryId ? { ...candidate, choices: [...candidate.choices, { decisionId: open.decisionId, text, turnIndex: candidate.turnCount, at }] } : candidate)),
      }));
    }
    const promptId = await this.sendTurn(workspaceId, taskId, agent, text);
    return this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, trigger: 'reply' as TaskTrigger, promptIds: [...current.promptIds, promptId], supplements: [...(current.supplements ?? []), text], endedAt: undefined, verification: undefined }));
  }

  async choosePlan(workspaceId: string, decisionId: string, planId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const plan = this.requirePlan(decision, planId);
    if (plan.abandoned !== undefined) throw new ContinuoError('invalid_state', `plan ${planId} was abandoned`);
    const line = this.requireCurrent(doc);
    this.assertIdle(doc, line);
    const status = planStatusOn(doc, line, decision, plan);
    if (status.kind === 'current') return doc;
    if (status.kind === 'elsewhere') return this.activateTrajectory(workspaceId, status.trajectory.trajectoryId);
    const home = doc.trajectories.find((candidate) => candidate.trajectoryId === decision.trajectoryId);
    if (home === undefined) throw new ContinuoError('invalid_state', `the line of decision ${decisionId} is gone`);
    const at = new Date().toISOString();
    const roundPrompt = `选择方案${plan.planId}：${plan.title}`;
    if (home.trajectoryId === line.trajectoryId && choiceOn(home, decisionId) === undefined) {
      const task = this.requireTask(doc, decision.taskId);
      const session = await resumeSessionById(this.core.accessor, task.sessionId);
      if (session === undefined) throw new ContinuoError('invalid_state', `session ${task.sessionId} is gone`);
      const agent = await ensureMainAgent(session);
      await this.ensureModel(agent);
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
    const forked = await this.forkLine(workspaceId, home, decision.turnIndex, label, {
      taskIds: tasksThrough(doc, home, (candidate) => candidate.taskId !== decision.taskId),
      choices: [...inheritedChoices(home, decision.turnIndex), { decisionId, planId, turnIndex: decision.turnIndex + 1, at }],
      origin: { fromTrajectoryId: home.trajectoryId, turnIndex: decision.turnIndex, decisionId, planId },
    });
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
      throw new ContinuoError('invalid_state', 'more plans can only be added while this decision point is still open on the current line');
    }
    if (decision.exhausted !== undefined) throw new ContinuoError('invalid_state', 'no meaningfully different plan is left for this decision point');
    const task = this.requireTask(doc, decision.taskId);
    const session = await resumeSessionById(this.core.accessor, task.sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', `session ${task.sessionId} is gone`);
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
    this.attach(workspaceId, task.taskId, session, agent);
    const promptId = await this.sendTurn(workspaceId, task.taskId, agent, '再给几个方案，只要和已有方案思路明显不同的。如果已经没有真正不同的方向，就告诉我为什么，以及需要我来定的那个问题。', '再来几个方案');
    return this.patchTask(workspaceId, task.taskId, (current) => ({ ...current, status: 'running', pendingInteraction: 'none', phase: undefined, promptIds: [...current.promptIds, promptId], endedAt: undefined }));
  }

  async abandonPlan(workspaceId: string, decisionId: string, planId: string, reason: string | undefined): Promise<ContinuoWorkspaceDoc> {
    const doc = await this.requireDoc(workspaceId);
    const decision = this.requireDecision(doc, decisionId);
    const plan = this.requirePlan(decision, planId);
    const line = this.requireCurrent(doc);
    if (choiceOn(line, decisionId)?.planId === planId) throw new ContinuoError('invalid_state', 'switch to another plan before abandoning the one this line follows');
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
    if (target === undefined) throw new ContinuoError('invalid_state', `line ${trajectoryId} does not exist`);
    if (target.status === 'abandoned') throw new ContinuoError('invalid_state', 'this line was abandoned');
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
    if (!line.taskIds.includes(taskId)) throw new ContinuoError('invalid_state', `task ${taskId} is not on the current line`);
    const turnIndex = lastTurnOf(task);
    if (turnIndex === undefined) throw new ContinuoError('invalid_state', 'this task has no finished turn to continue from');
    const kept = line.taskIds.slice(0, line.taskIds.indexOf(taskId) + 1);
    await this.forkLine(workspaceId, line, turnIndex, `从「${taskName(task)}」继续`, {
      taskIds: kept,
      choices: inheritedChoices(line, turnIndex),
      origin: { fromTrajectoryId: line.trajectoryId, turnIndex, afterTaskId: taskId },
    });
    return this.requireDoc(workspaceId);
  }

  private async forkLine(workspaceId: string, parent: Trajectory, turnIndex: number, label: string, shape: { taskIds: readonly string[]; choices: Trajectory['choices']; origin: TrajectoryOrigin }): Promise<{ trajectory: Trajectory; session: ISessionScopeHandle; agent: IAgentScopeHandle }> {
    const meta = await this.core.accessor.get(ISessionManager).fork({ sourceSessionId: parent.sessionId, turnIndex, title: `Continuo · ${label}` });
    const session = await resumeSessionById(this.core.accessor, meta.id);
    if (session === undefined) throw new ContinuoError('invalid_state', `forked session ${meta.id} could not be opened`);
    const agent = await ensureMainAgent(session);
    await this.ensureModel(agent);
    const trajectory: Trajectory = { trajectoryId: `trj_${randomUUID().slice(0, 8)}`, label, sessionId: meta.id, status: 'current', taskIds: shape.taskIds, choices: shape.choices, turnCount: turnIndex + 1, origin: shape.origin, createdAt: new Date().toISOString() };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: [...current.trajectories.map((candidate) => (candidate.status === 'current' ? { ...candidate, status: 'alternative' as const } : candidate)), trajectory],
    }));
    return { trajectory, session, agent };
  }

  private assertIdle(doc: ContinuoWorkspaceDoc, line: Trajectory): void {
    const busy = doc.tasks.find((task) => line.taskIds.includes(task.taskId) && (BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval'))));
    if (busy !== undefined) throw new ContinuoError('invalid_state', `task ${busy.taskId} is still ${busy.status}; wait for it or stop it first`);
  }

  private requireCurrent(doc: ContinuoWorkspaceDoc): Trajectory {
    const line = currentTrajectory(doc);
    if (line === undefined) throw new ContinuoError('invalid_state', 'this project has no line yet');
    return line;
  }

  private requireDecision(doc: ContinuoWorkspaceDoc, decisionId: string): Decision {
    const decision = doc.decisions.find((candidate) => candidate.decisionId === decisionId);
    if (decision === undefined) throw new ContinuoError('invalid_state', `decision ${decisionId} does not exist`);
    return decision;
  }

  private requirePlan(decision: Decision, planId: string): TrajectoryPlan {
    const plan = decision.plans.find((candidate) => candidate.planId === planId);
    if (plan === undefined) throw new ContinuoError('invalid_state', `plan ${planId} does not exist`);
    return plan;
  }

  private otherPlanDeliverables(doc: ContinuoWorkspaceDoc, task: ContinuoTask): Set<string> {
    const decisionId = task.branch?.decisionId ?? doc.decisions.find((decision) => decision.taskId === task.taskId)?.decisionId;
    if (decisionId === undefined) return new Set();
    const home = doc.decisions.find((decision) => decision.decisionId === decisionId)?.taskId;
    const siblings = doc.tasks.filter((candidate) => candidate.taskId !== task.taskId && (candidate.taskId === home || candidate.branch?.decisionId === decisionId));
    return new Set(siblings.flatMap((candidate) => (candidate.report?.deliverables ?? []).filter((item) => item.exists !== false).map((item) => item.path)));
  }

  private async writePlanFiles(workspaceId: string, taskId: string): Promise<void> {
    const doc = await this.requireDoc(workspaceId);
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) return;
    const decisions = doc.decisions.filter((decision) => decision.taskId === taskId);
    try {
      await mkdir(resolve(doc.root, WORK_LOG_DIR), { recursive: true });
      for (const decision of decisions) {
        for (const plan of decision.plans) await writeFile(resolve(doc.root, plan.path), renderPlan(doc, task, decision, plan), 'utf8');
      }
    } catch {
      return;
    }
  }

  private reconcileOnOpen(task: ContinuoTask): ContinuoTask {
    const inFlight = task.status === 'running' || task.status === 'verifying' || task.status === 'queued' || (task.status === 'awaiting_user' && task.pendingInteraction !== 'reply' && task.pendingInteraction !== 'choice');
    if (inFlight && !this.attachments.has(task.taskId)) {
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
    await this.writePlanFiles(workspaceId, taskId);
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
    const settled = await this.requireDoc(workspaceId);
    const line = trajectoryOfSession(settled, task.sessionId);
    if (line !== undefined && openDecisionOf(settled, line, taskId) !== undefined) {
      const reply = (this.attachments.get(taskId)?.reply ?? '').trim().slice(0, 4000);
      await this.patchTask(workspaceId, taskId, (current) => ({ ...current, status: 'awaiting_user' as TaskStatus, pendingInteraction: 'choice' as const, phase: '等你选方案', lastReply: reply === '' ? current.lastReply : reply }));
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
    const others = this.otherPlanDeliverables(fresh, current);
    const overwritten = deliverables.filter((item) => others.has(item.path)).map((item) => item.path);
    if (overwritten.length > 0) notes.push(`overwrote a file produced by another plan: ${overwritten.join(', ')}`);
    const missing = deliverables.some((item) => item.exists === false) || overwritten.length > 0;
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


function stamp(iso: string | undefined): string {
  return iso === undefined ? '' : `${localDay(iso)} ${localTime(iso)}`;
}

function oneLine(text: string, max: number): string {
  const line = text.split('\n').map((part) => part.trim()).filter((part) => part !== '').join(' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function planPrompt(plan: TrajectoryPlan): string {
  return `按方案 ${plan.planId}「${plan.title}」继续：${plan.prompt}`;
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
    for (const item of deliverables) lines.push(`| ${item.path} | ${item.note === undefined || item.note === '' ? '—' : item.note} | ${item.exists === false ? '❌ 没找到' : '✅'} |`);
    for (const { decision, plan } of plans) lines.push(`| ${plan.path} | 方案 ${plan.planId}：${plan.title} | ${planStatusText(doc, task, decision, plan)} |`);
  }
  const notes = [
    ...(task.report?.unresolved ?? []).map((item) => `- 未完成：${item}`),
    ...(task.report?.nextStep === undefined ? [] : [`- 建议的下一步：${task.report.nextStep.title}——${task.report.nextStep.reason}`]),
  ];
  if (notes.length > 0) lines.push('', '### 备注', '', ...notes);
  return lines;
}
