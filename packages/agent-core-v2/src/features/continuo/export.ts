import { choiceOn, currentTrajectory, planStatusOn, taskCategory, taskName } from './trajectory';
import type { ContinuoTask, ContinuoWorkspaceDoc, Decision, Suggestion, Trajectory, TrajectoryPlan } from './types';

export interface DeliverableFeedback {
  readonly exists: boolean;
  readonly modifiedAfter: boolean;
}

export interface SamplePlan {
  readonly planId: string;
  readonly title: string;
  readonly basis: string;
  readonly risk: string;
  readonly fate: 'chosen' | 'not_taken' | 'taken_elsewhere' | 'abandoned';
  readonly abandonReason?: string;
  readonly author?: { readonly angle: string; readonly steps: number };
}

export interface SampleDecision {
  readonly decisionId: string;
  readonly question: string;
  readonly explored: boolean;
  readonly plans: readonly SamplePlan[];
  readonly chosen?: string;
  readonly ownDirection?: string;
  readonly exhausted?: { readonly reason: string; readonly ask: string };
  readonly withdrawn: readonly string[];
}

export interface SampleTask {
  readonly taskId: string;
  readonly name: string;
  readonly category?: string;
  readonly request: string;
  readonly supplements: readonly string[];
  readonly status: string;
  readonly rounds: ReadonlyArray<{ readonly prompt: string; readonly reads: readonly string[]; readonly writes: readonly string[]; readonly reply: string }>;
  readonly deliverables: ReadonlyArray<{ readonly path: string; readonly exists: boolean; readonly modifiedAfter: boolean; readonly usedLater: boolean }>;
  readonly unresolved: readonly string[];
  readonly nextStep?: { readonly title: string; readonly started: boolean };
}

export interface TrajectorySample {
  readonly trajectoryId: string;
  readonly status: Trajectory['status'];
  readonly current: boolean;
  readonly branchedFrom?: { readonly trajectoryId: string; readonly kind: 'plan' | 'task'; readonly decisionId?: string; readonly planId?: string; readonly afterTaskId?: string };
  readonly abandonReason?: string;
  readonly tasks: readonly SampleTask[];
  readonly decisions: readonly SampleDecision[];
}

export interface PreferencePair {
  readonly decisionId: string;
  readonly question: string;
  readonly request: string;
  readonly preferred: { readonly planId: string; readonly title: string; readonly basis: string; readonly risk: string };
  readonly other: { readonly planId: string; readonly title: string; readonly basis: string; readonly risk: string };
  readonly signal: 'abandoned' | 'switched_away' | 'not_taken';
  readonly reason?: string;
}

export interface TrajectoryExport {
  readonly workspace: { readonly name: string; readonly exportedAt: string; readonly context: { readonly understanding?: string; readonly points: readonly string[] } };
  readonly samples: readonly TrajectorySample[];
  readonly preferences: readonly PreferencePair[];
}

const STRENGTH: Record<PreferencePair['signal'], number> = { abandoned: 0, switched_away: 1, not_taken: 2 };

export function buildTrajectoryExport(doc: ContinuoWorkspaceDoc, feedback: ReadonlyMap<string, DeliverableFeedback>, exportedAt: string): TrajectoryExport {
  const current = currentTrajectory(doc);
  const samples = doc.trajectories.map((line) => sampleOf(doc, line, current, feedback));
  return {
    workspace: { name: doc.root.split('/').filter(Boolean).pop() ?? doc.root, exportedAt, context: { understanding: doc.understanding?.text, points: doc.context.map((entry) => entry.text) } },
    samples,
    preferences: doc.decisions.flatMap((decision) => pairsOf(doc, decision, current)).toSorted((a, b) => STRENGTH[a.signal] - STRENGTH[b.signal]),
  };
}

function sampleOf(doc: ContinuoWorkspaceDoc, line: Trajectory, current: Trajectory | undefined, feedback: ReadonlyMap<string, DeliverableFeedback>): TrajectorySample {
  const tasks = line.taskIds.map((taskId) => doc.tasks.find((task) => task.taskId === taskId)).filter((task): task is ContinuoTask => task !== undefined);
  const later = (index: number) => tasks.slice(index + 1);
  const decisions = doc.decisions.filter((decision) => choiceOn(line, decision.decisionId) !== undefined || (line.taskIds.includes(decision.taskId) && decision.trajectoryId === line.trajectoryId));
  return {
    trajectoryId: line.trajectoryId,
    status: line.status,
    current: line.trajectoryId === current?.trajectoryId,
    branchedFrom: line.origin === undefined ? undefined : {
      trajectoryId: line.origin.fromTrajectoryId,
      kind: line.origin.decisionId === undefined ? 'task' : 'plan',
      decisionId: line.origin.decisionId,
      planId: line.origin.planId,
      afterTaskId: line.origin.afterTaskId,
    },
    abandonReason: line.abandonReason,
    tasks: tasks.map((task, index) => ({
      taskId: task.taskId,
      name: taskName(task),
      category: taskCategory(task),
      request: task.rounds?.[0]?.prompt ?? task.title,
      supplements: task.supplements ?? [],
      status: task.status,
      rounds: (task.rounds ?? []).map((round) => ({ prompt: round.prompt, reads: round.reads, writes: round.writes, reply: round.reply })),
      deliverables: (task.report?.deliverables ?? []).map((item) => {
        const signal = feedback.get(`${task.taskId}:${item.path}`);
        return {
          path: item.path,
          exists: signal?.exists ?? item.exists !== false,
          modifiedAfter: signal?.modifiedAfter ?? false,
          usedLater: later(index).some((next) => (next.sources ?? []).includes(item.path)),
        };
      }),
      unresolved: task.report?.unresolved ?? [],
      nextStep: task.report?.nextStep === undefined ? undefined : { title: task.report.nextStep.title, started: nextStepStarted(doc, task, task.report.nextStep) },
    })),
    decisions: decisions.map((decision) => decisionOf(doc, line, decision)),
  };
}

function nextStepStarted(doc: ContinuoWorkspaceDoc, task: ContinuoTask, nextStep: Suggestion): boolean {
  return (doc.todos ?? []).some((todo) => todo.state === 'started' && (todo.fromTaskId === task.taskId || todo.text === nextStep.prompt));
}

function decisionOf(doc: ContinuoWorkspaceDoc, line: Trajectory, decision: Decision): SampleDecision {
  const choice = choiceOn(line, decision.decisionId);
  return {
    decisionId: decision.decisionId,
    question: decision.question,
    explored: decision.exploration !== undefined,
    plans: decision.plans.map((plan) => {
      const status = planStatusOn(doc, line, decision, plan);
      const author = decision.exploration?.angles.find((angle) => angle.planId === plan.planId);
      return {
        planId: plan.planId,
        title: plan.title,
        basis: plan.basis,
        risk: plan.risk,
        fate: status.kind === 'current' ? 'chosen' : status.kind === 'elsewhere' ? 'taken_elsewhere' : status.kind === 'abandoned' ? 'abandoned' : 'not_taken',
        abandonReason: plan.abandoned?.reason,
        author: author === undefined ? undefined : { angle: author.angle, steps: author.usage?.steps ?? 0 },
      };
    }),
    chosen: choice?.planId,
    ownDirection: choice !== undefined && choice.planId === undefined ? choice.text : undefined,
    exhausted: decision.exhausted === undefined ? undefined : { reason: decision.exhausted.reason, ask: decision.exhausted.ask },
    withdrawn: (decision.exploration?.angles ?? []).filter((angle) => angle.status === 'withdrawn').map((angle) => `${angle.title}${angle.note === undefined ? '' : `（${angle.note}）`}`),
  };
}

function pairsOf(doc: ContinuoWorkspaceDoc, decision: Decision, current: Trajectory | undefined): PreferencePair[] {
  const followedBy = (plan: TrajectoryPlan) => doc.trajectories.filter((line) => choiceOn(line, decision.decisionId)?.planId === plan.planId);
  const preferredLine = current !== undefined && choiceOn(current, decision.decisionId)?.planId !== undefined
    ? current
    : doc.trajectories.findLast((line) => line.status !== 'abandoned' && choiceOn(line, decision.decisionId)?.planId !== undefined);
  const preferredId = preferredLine === undefined ? undefined : choiceOn(preferredLine, decision.decisionId)?.planId;
  const preferred = decision.plans.find((plan) => plan.planId === preferredId);
  if (preferred === undefined) return [];
  const task = doc.tasks.find((candidate) => candidate.taskId === decision.taskId);
  const brief = (plan: TrajectoryPlan) => ({ planId: plan.planId, title: plan.title, basis: plan.basis, risk: plan.risk });
  return decision.plans.filter((plan) => plan.planId !== preferred.planId).map((plan) => {
    const signal: PreferencePair['signal'] = plan.abandoned !== undefined ? 'abandoned' : followedBy(plan).length > 0 ? 'switched_away' : 'not_taken';
    return { decisionId: decision.decisionId, question: decision.question, request: task?.rounds?.[0]?.prompt ?? task?.title ?? '', preferred: brief(preferred), other: brief(plan), signal, reason: plan.abandoned?.reason };
  });
}
