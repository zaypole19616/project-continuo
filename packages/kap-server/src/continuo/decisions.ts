import { randomUUID } from 'node:crypto';

import {
  EMPTY_USAGE,
  IAgentLoopService,
  IContinuoStore,
  IEventBus,
  choiceOn,
  inheritedChoices,
  isExploring,
  lastTurnOf,
  lineById,
  lineRoot,
  openDecisionOf,
  planStatusOn,
  taskName,
  tasksThrough,
  trajectoryOfSession,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type Decision,
  type ExplorationAngle,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
  type TaskStatus,
  type Trajectory,
  type TrajectoryOrigin,
} from '@moonshot-ai/agent-core-v2';

import { patchTask, requireCurrent, requireDecision, requireDoc, requirePlan, requireTask } from './doc';
import { ContinuoError } from './errors';
import { createLineDir, linesSettled, snapshotDir } from './lines';
import { MAIN_TURN_MORE_PLANS, hiddenTurnWritePlan, mainTurnAdoptPlan, mainTurnComparePlans } from './prompts';
import { writePlanFiles, writeWorkLog } from './render';
import { assertIdle, started, toAwaiting, toEnded, toRunning } from './taskState';
import type { Workers } from './workers';

interface Explorer {
  readonly dispose: () => void;
  readonly agent: IAgentScopeHandle;
  readonly decisionId: string;
  readonly key: string;
}

interface LineShape {
  readonly taskIds: readonly string[];
  readonly choices: Trajectory['choices'];
  readonly origin: TrajectoryOrigin;
}

const FINAL_ANGLE = new Set<ExplorationAngle['status']>(['submitted', 'withdrawn', 'failed']);
const COPY_MAX_BYTES = 300 * 1024 * 1024;

export function canCopyProject(doc: ContinuoWorkspaceDoc): boolean {
  if (doc.scan === undefined || doc.scan.truncated) return false;
  return doc.scan.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) <= COPY_MAX_BYTES;
}

export async function takeSnapshot(store: IContinuoStore, workspaceId: string, taskId: string): Promise<void> {
  const doc = await requireDoc(store, workspaceId);
  const task = requireTask(doc, taskId);
  const line = trajectoryOfSession(doc, task.sessionId);
  if (task.kind !== 'user' || line === undefined) return;
  const open = openDecisionOf(doc, line, taskId);
  if (open !== undefined && isExploring(open)) return;
  if (!canCopyProject(doc)) return;
  const label = open === undefined ? `task/${taskId}` : `decision/${open.decisionId}`;
  const commit = await snapshotDir(doc.root, lineRoot(doc, line), label);
  if (commit === undefined) return;
  await store.update(workspaceId, (current) => (open === undefined
    ? { ...current, tasks: current.tasks.map((candidate) => (candidate.taskId === taskId ? { ...candidate, snapshot: commit } : candidate)) }
    : { ...current, decisions: current.decisions.map((candidate) => (candidate.decisionId === open.decisionId ? { ...candidate, snapshot: commit } : candidate)) }));
}

export class Decisions {
  private readonly explorers = new Map<string, Explorer>();

  constructor(private readonly core: Scope, private readonly workers: Workers) {}

  private get store(): IContinuoStore {
    return this.core.accessor.get(IContinuoStore);
  }

  async choosePlan(workspaceId: string, decisionId: string, planId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const decision = requireDecision(doc, decisionId);
    const plan = requirePlan(decision, planId);
    if (plan.abandoned !== undefined) throw new ContinuoError('invalid_state', '这个方案已经放弃了。');
    const line = requireCurrent(doc);
    assertIdle(doc, line);
    const status = planStatusOn(doc, line, decision, plan);
    if (status.kind === 'current') return doc;
    if (status.kind === 'elsewhere') return this.activateTrajectory(workspaceId, status.trajectory.trajectoryId);
    const home = doc.trajectories.find((candidate) => candidate.trajectoryId === decision.trajectoryId);
    if (home === undefined) throw new ContinuoError('invalid_state', '这个决策所在的轨迹找不到了。');
    const at = new Date().toISOString();
    const turn = mainTurnAdoptPlan(plan);
    if (home.trajectoryId === line.trajectoryId && choiceOn(home, decisionId) === undefined) {
      const task = requireTask(doc, decision.taskId);
      const agent = await this.workers.attachWorker(workspaceId, task);
      await this.store.update(workspaceId, (current) => ({
        ...current,
        trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === home.trajectoryId ? { ...candidate, choices: [...candidate.choices, { decisionId, planId, turnIndex: candidate.turnCount, at }] } : candidate)),
      }));
      const promptId = await this.workers.sendTurn(workspaceId, task.taskId, agent, turn);
      await patchTask(this.store, workspaceId, task.taskId, (current) => toRunning(current, { promptId, trigger: 'plan' }));
      await writePlanFiles(this.store, workspaceId, task.taskId);
      return requireDoc(this.store, workspaceId);
    }
    const origin = requireTask(doc, decision.taskId);
    const label = `方案${plan.planId}`;
    await linesSettled(doc.root);
    const forked = await this.forkLine(workspaceId, home, decision.turnIndex, label, {
      taskIds: tasksThrough(doc, home, (candidate) => candidate.taskId !== decision.taskId),
      choices: [...inheritedChoices(home, decision.turnIndex), { decisionId, planId, turnIndex: decision.turnIndex + 1, at }],
      origin: { fromTrajectoryId: home.trajectoryId, turnIndex: decision.turnIndex, decisionId, planId },
    }, requireDecision(await requireDoc(this.store, workspaceId), decisionId).snapshot);
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
      usage: EMPTY_USAGE,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      tasks: [...current.tasks, branchTask],
      trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === forked.trajectory.trajectoryId ? { ...candidate, taskIds: [...candidate.taskIds, taskId] } : candidate)),
    }));
    this.workers.attach(workspaceId, taskId, forked.session, forked.agent);
    const promptId = await this.workers.sendTurn(workspaceId, taskId, forked.agent, turn);
    await patchTask(this.store, workspaceId, taskId, (current) => started(current, promptId));
    await writePlanFiles(this.store, workspaceId, decision.taskId);
    return requireDoc(this.store, workspaceId);
  }

  async expandPlans(workspaceId: string, decisionId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const decision = requireDecision(doc, decisionId);
    const line = requireCurrent(doc);
    assertIdle(doc, line);
    if (decision.trajectoryId !== line.trajectoryId || choiceOn(line, decisionId) !== undefined) {
      throw new ContinuoError('invalid_state', '只有还没选定的决策才能再要方案。');
    }
    if (decision.exhausted !== undefined) throw new ContinuoError('invalid_state', '这个决策已经没有明显不同的方案了。');
    const task = requireTask(doc, decision.taskId);
    const agent = await this.workers.attachWorker(workspaceId, task);
    const promptId = await this.workers.sendTurn(workspaceId, task.taskId, agent, MAIN_TURN_MORE_PLANS);
    return patchTask(this.store, workspaceId, task.taskId, (current) => toRunning(current, { promptId }));
  }

  async abandonPlan(workspaceId: string, decisionId: string, planId: string, reason: string | undefined): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const decision = requireDecision(doc, decisionId);
    const plan = requirePlan(decision, planId);
    const line = requireCurrent(doc);
    if (choiceOn(line, decisionId)?.planId === planId) throw new ContinuoError('invalid_state', '先换到别的方案，再放弃这一个。');
    const at = new Date().toISOString();
    const note = reason === undefined || reason.trim() === '' ? undefined : reason.trim().slice(0, 300);
    await this.store.update(workspaceId, (current) => ({
      ...current,
      decisions: current.decisions.map((candidate) => (candidate.decisionId !== decisionId ? candidate : { ...candidate, plans: candidate.plans.map((item) => (item.planId === plan.planId ? { ...item, abandoned: { reason: note, at } } : item)) })),
      trajectories: current.trajectories.map((candidate) => (candidate.status !== 'current' && choiceOn(candidate, decisionId)?.planId === planId ? { ...candidate, status: 'abandoned', abandonReason: note } : candidate)),
    }));
    await writePlanFiles(this.store, workspaceId, decision.taskId);
    await writeWorkLog(this.store, workspaceId, decision.taskId);
    return requireDoc(this.store, workspaceId);
  }

  async activateTrajectory(workspaceId: string, trajectoryId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const target = doc.trajectories.find((candidate) => candidate.trajectoryId === trajectoryId);
    if (target === undefined) throw new ContinuoError('invalid_state', '这条轨迹找不到了。');
    if (target.status === 'abandoned') throw new ContinuoError('invalid_state', '这条轨迹已经放弃了。');
    if (target.status === 'current') return doc;
    assertIdle(doc, requireCurrent(doc));
    return this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: current.trajectories.map((candidate) => (candidate.trajectoryId === trajectoryId ? { ...candidate, status: 'current' } : candidate.status === 'current' ? { ...candidate, status: 'alternative' } : candidate)),
    }));
  }

  async forkAfterTask(workspaceId: string, taskId: string): Promise<ContinuoWorkspaceDoc> {
    const doc = await requireDoc(this.store, workspaceId);
    const line = requireCurrent(doc);
    assertIdle(doc, line);
    const task = requireTask(doc, taskId);
    if (!line.taskIds.includes(taskId)) throw new ContinuoError('invalid_state', '这件事不在当前轨迹上。');
    const turnIndex = lastTurnOf(task);
    if (turnIndex === undefined) throw new ContinuoError('invalid_state', '这件事还没有完成的一轮，不能从这里接着做。');
    const kept = line.taskIds.slice(0, line.taskIds.indexOf(taskId) + 1);
    await linesSettled(doc.root);
    const latest = line.taskIds.at(-1) === taskId;
    const commit = requireTask(await requireDoc(this.store, workspaceId), taskId).snapshot
      ?? (latest && canCopyProject(doc) ? await snapshotDir(doc.root, lineRoot(doc, line), `task/${taskId}`) : undefined);
    await this.forkLine(workspaceId, line, turnIndex, `从「${taskName(task)}」继续`, {
      taskIds: kept,
      choices: inheritedChoices(line, turnIndex),
      origin: { fromTrajectoryId: line.trajectoryId, turnIndex, afterTaskId: taskId },
    }, commit);
    return requireDoc(this.store, workspaceId);
  }

  private async forkLine(workspaceId: string, parent: Trajectory, turnIndex: number, label: string, shape: LineShape, commit: string | undefined): Promise<{ trajectory: Trajectory; session: ISessionScopeHandle; agent: IAgentScopeHandle }> {
    const meta = await this.workers.forkWhenIdle(await requireDoc(this.store, workspaceId), parent.sessionId, turnIndex, `Continuo · ${label}`);
    const session = await this.workers.openSession(meta.id, '复制出的对话没能打开');
    const agent = await this.workers.prepare(session, workspaceId);
    const trajectoryId = `trj_${randomUUID().slice(0, 8)}`;
    const root = (await requireDoc(this.store, workspaceId)).root;
    const workDir = commit === undefined ? undefined : await createLineDir(root, commit, trajectoryId);
    const trajectory: Trajectory = { trajectoryId, label, sessionId: meta.id, status: 'current', taskIds: shape.taskIds, choices: shape.choices, turnCount: turnIndex + 1, origin: shape.origin, workDir, createdAt: new Date().toISOString() };
    await this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: [...current.trajectories.map((candidate) => (candidate.status === 'current' ? { ...candidate, status: 'alternative' as const } : candidate)), trajectory],
    }));
    return { trajectory, session, agent };
  }

  async startExploration(workspaceId: string, decisionId: string): Promise<void> {
    const doc = await requireDoc(this.store, workspaceId);
    const decision = requireDecision(doc, decisionId);
    const home = lineById(doc, decision.trajectoryId);
    if (home === undefined) {
      await this.finishExploration(workspaceId, decisionId, '没能开始');
      return;
    }
    for (const angle of decision.exploration!.angles) {
      if (!isExploring(requireDecision(await requireDoc(this.store, workspaceId), decisionId))) return;
      try {
        const meta = await this.workers.forkWhenIdle(doc, home.sessionId, decision.turnIndex, `Continuo · 方案 ${angle.key}`);
        const session = await this.workers.openSession(meta.id, '复制出的对话没能打开');
        const agent = await this.workers.prepare(session, workspaceId, 'auto');
        await this.patchAngle(workspaceId, decisionId, angle.key, (current) => ({ ...current, status: 'running', sessionId: meta.id }));
        if (!isExploring(requireDecision(await requireDoc(this.store, workspaceId), decisionId))) return;
        this.attachExplorer(workspaceId, decisionId, angle.key, meta.id, agent);
        this.workers.submit(agent, hiddenTurnWritePlan(angle));
      } catch (error) {
        const note = `没能开始（${(error as Error).message.slice(0, 120)}）`;
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
        const steps = before.steps + 1;
        over = current.status === 'running' && steps >= maxSteps;
        return {
          ...current,
          usage: {
            steps,
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
    const decision = (await requireDoc(this.store, workspaceId)).decisions.find((candidate) => candidate.decisionId === decisionId);
    if (decision === undefined || !isExploring(decision)) return;
    if (decision.exploration!.angles.every((angle) => FINAL_ANGLE.has(angle.status))) await this.finishExploration(workspaceId, decisionId, undefined);
  }

  async finishExploration(workspaceId: string, decisionId: string, stopped: string | undefined): Promise<void> {
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
      await writeWorkLog(this.store, workspaceId, taskId);
      return;
    }
    if (decision.plans.length > 1 && stopped === undefined && await this.askToRecommend(workspaceId, decision)) {
      await writePlanFiles(this.store, workspaceId, taskId);
      return;
    }
    if (decision.plans.length > 0) {
      await patchTask(this.store, workspaceId, taskId, (current) => ({ ...toAwaiting(current, 'choice', '等你选方案'), pauseRequested: false, endedAt }));
      await writePlanFiles(this.store, workspaceId, taskId);
    } else {
      const status: TaskStatus = stopped === '已停止' ? 'paused' : stopped === '被打断' ? 'interrupted' : 'failed';
      await patchTask(this.store, workspaceId, taskId, (current) => ({ ...toEnded(current, status, endedAt), error: { code: 'turn.failed', message: `分头写的 ${count} 个方案都没能完成`, at: endedAt } }));
    }
    await writeWorkLog(this.store, workspaceId, taskId);
    await takeSnapshot(this.store, workspaceId, taskId);
  }

  private async askToRecommend(workspaceId: string, decision: Decision): Promise<boolean> {
    const task = requireTask(await requireDoc(this.store, workspaceId), decision.taskId);
    let agent: IAgentScopeHandle;
    try {
      agent = await this.workers.attachWorker(workspaceId, task);
    } catch {
      return false;
    }
    const promptId = await this.workers.sendTurn(workspaceId, task.taskId, agent, mainTurnComparePlans(decision.plans));
    await patchTask(this.store, workspaceId, task.taskId, (current) => toRunning(current, { promptId, phase: '在比较方案' }));
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
}
