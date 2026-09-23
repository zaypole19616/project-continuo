import type { ContinuoDoc, ContinuoTask, Decision, Trajectory, TrajectoryChoice, TrajectoryPlan } from './api';

export type PlanState = { kind: 'current' } | { kind: 'abandoned' } | { kind: 'elsewhere'; line: Trajectory; tasks: number } | { kind: 'open' };

export interface LineStub { line: Trajectory; label: string; tasks: number }

export type TrunkItem =
  | { kind: 'day'; day: string }
  | { kind: 'task'; task: ContinuoTask; stubs: LineStub[] }
  | { kind: 'decision'; decision: Decision; choice?: TrajectoryChoice };

const BUSY = new Set(['queued', 'running', 'verifying']);

export function currentLine(doc: ContinuoDoc): Trajectory | undefined {
  return doc.trajectories.find((line) => line.status === 'current');
}

export function choiceOn(line: Trajectory, decisionId: string): TrajectoryChoice | undefined {
  return line.choices.find((choice) => choice.decisionId === decisionId);
}

export function tasksOn(doc: ContinuoDoc, line: Trajectory | undefined): ContinuoTask[] {
  if (line === undefined) return [];
  return line.taskIds.map((taskId) => doc.tasks.find((task) => task.taskId === taskId)).filter((task): task is ContinuoTask => task !== undefined);
}

export function decisionsOn(doc: ContinuoDoc, line: Trajectory): Decision[] {
  const own = new Set(line.taskIds);
  return doc.decisions.filter((decision) => choiceOn(line, decision.decisionId) !== undefined || (own.has(decision.taskId) && decision.trajectoryId === line.trajectoryId));
}

export function planState(doc: ContinuoDoc, line: Trajectory, decision: Decision, plan: TrajectoryPlan): PlanState {
  if (choiceOn(line, decision.decisionId)?.planId === plan.planId) return { kind: 'current' };
  if (plan.abandoned !== undefined) return { kind: 'abandoned' };
  const elsewhere = doc.trajectories.findLast((other) => other.trajectoryId !== line.trajectoryId && other.status !== 'abandoned' && choiceOn(other, decision.decisionId)?.planId === plan.planId);
  if (elsewhere === undefined) return { kind: 'open' };
  const own = new Set(line.taskIds);
  return { kind: 'elsewhere', line: elsewhere, tasks: elsewhere.taskIds.filter((taskId) => !own.has(taskId)).length };
}

export function isExploring(decision: Decision): boolean {
  return decision.exploration !== undefined && decision.exploration.endedAt === undefined;
}

export function isOpen(line: Trajectory, decision: Decision): boolean {
  return decision.trajectoryId === line.trajectoryId && choiceOn(line, decision.decisionId) === undefined;
}

export function lineIsBusy(doc: ContinuoDoc, line: Trajectory | undefined): boolean {
  return tasksOn(doc, line).some((task) => BUSY.has(task.status) || (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval')));
}

export function taskLabel(task: ContinuoTask): string {
  if (task.kind === 'init') return '了解项目';
  if (task.name !== undefined && task.name.trim() !== '') return task.name.trim();
  const head = (task.title.split(/[\n，。,.；;!?！？]/)[0] ?? '').trim();
  return head === '' ? task.title : head.slice(0, 16);
}

export function localDay(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function localTime(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function lastTurnOf(task: ContinuoTask): number | undefined {
  return (task.rounds ?? []).findLast((round) => round.turnIndex !== undefined)?.turnIndex;
}

function lineStubsAt(doc: ContinuoDoc, line: Trajectory, taskId: string): LineStub[] {
  const stubs: LineStub[] = [];
  const at = line.taskIds.indexOf(taskId);
  const parent = line.origin?.afterTaskId === taskId ? doc.trajectories.find((other) => other.trajectoryId === line.origin?.fromTrajectoryId) : undefined;
  if (parent !== undefined && parent.status !== 'abandoned') {
    const index = parent.taskIds.indexOf(taskId);
    stubs.push({ line: parent, label: '原来的轨迹', tasks: index === -1 ? 0 : parent.taskIds.length - index - 1 });
  }
  for (const other of doc.trajectories) {
    if (other.trajectoryId === line.trajectoryId || other.status === 'abandoned' || other.origin?.afterTaskId !== taskId || other === parent) continue;
    stubs.push({ line: other, label: other.label, tasks: Math.max(0, other.taskIds.length - at - 1) });
  }
  return stubs;
}

export function buildTrunk(doc: ContinuoDoc, line: Trajectory): TrunkItem[] {
  const items: TrunkItem[] = [];
  let day = '';
  const decisions = decisionsOn(doc, line);
  const emitDecision = (decision: Decision) => items.push({ kind: 'decision', decision, choice: choiceOn(line, decision.decisionId) });
  for (const task of tasksOn(doc, line)) {
    const taskDay = localDay(task.createdAt);
    if (taskDay !== day) {
      items.push({ kind: 'day', day: taskDay });
      day = taskDay;
    }
    for (const decision of decisions) if (decision.taskId === task.taskId || decision.decisionId === task.branch?.decisionId) emitDecision(decision);
    items.push({ kind: 'task', task, stubs: lineStubsAt(doc, line, task.taskId) });
  }
  return items;
}
