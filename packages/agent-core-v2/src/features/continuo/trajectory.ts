import type { ContinuoTask, ContinuoWorkspaceDoc, Decision, Trajectory, TrajectoryChoice, TrajectoryPlan } from './types';

export const WORK_LOG_DIR = 'work-log';

export function currentTrajectory(doc: ContinuoWorkspaceDoc): Trajectory | undefined {
  return doc.trajectories.find((trajectory) => trajectory.status === 'current');
}

export function trajectoryOfSession(doc: ContinuoWorkspaceDoc, sessionId: string): Trajectory | undefined {
  return doc.trajectories.find((trajectory) => trajectory.sessionId === sessionId);
}

export function choiceOn(trajectory: Trajectory, decisionId: string): TrajectoryChoice | undefined {
  return trajectory.choices.find((choice) => choice.decisionId === decisionId);
}

export function openDecisionOf(doc: ContinuoWorkspaceDoc, trajectory: Trajectory, taskId: string): Decision | undefined {
  return doc.decisions.findLast((decision) => decision.taskId === taskId && decision.trajectoryId === trajectory.trajectoryId && choiceOn(trajectory, decision.decisionId) === undefined);
}

export function decisionsOn(doc: ContinuoWorkspaceDoc, trajectory: Trajectory): Decision[] {
  const own = new Set(trajectory.taskIds);
  return doc.decisions.filter((decision) => choiceOn(trajectory, decision.decisionId) !== undefined || (own.has(decision.taskId) && decision.trajectoryId === trajectory.trajectoryId));
}

export function inheritedChoices(parent: Trajectory, turnIndex: number): TrajectoryChoice[] {
  return parent.choices.filter((choice) => choice.turnIndex <= turnIndex);
}

export function tasksThrough(doc: ContinuoWorkspaceDoc, parent: Trajectory, predicate: (task: ContinuoTask) => boolean): string[] {
  const kept: string[] = [];
  for (const taskId of parent.taskIds) {
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined || !predicate(task)) break;
    kept.push(taskId);
  }
  return kept;
}

export function lastTurnOf(task: ContinuoTask): number | undefined {
  return (task.rounds ?? []).findLast((round) => round.turnIndex !== undefined)?.turnIndex;
}

export function planLetter(index: number): string {
  return index < 26 ? String.fromCodePoint(65 + index) : `P${index + 1}`;
}

export function localDay(iso: string): string {
  const at = new Date(iso);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function localTime(iso: string): string {
  const at = new Date(iso);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function logSlug(name: string): string {
  const cleaned = name.replaceAll(/[\\/:*?"<>|]/g, '').replaceAll(/\s+/g, '-').slice(0, 20).replaceAll(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? 'task' : cleaned;
}

export function taskName(task: ContinuoTask): string {
  if (task.kind === 'init') return '了解项目';
  if (task.name !== undefined && task.name.trim() !== '') return task.name.trim();
  const head = (task.title.split(/[\n，。,.；;!?！？]/)[0] ?? '').trim();
  return head === '' ? '任务' : head.slice(0, 12);
}

export function taskCategory(task: ContinuoTask): string | undefined {
  return task.kind === 'init' ? 'init' : task.category;
}

export function planPath(task: ContinuoTask, planId: string, at: string): string {
  const parts = ['plan', localDay(at), taskCategory(task), logSlug(taskName(task)), `方案${planId}`];
  return `${WORK_LOG_DIR}/${parts.filter((part) => part !== undefined && part !== '').join('-')}.md`;
}

export function planStatusOn(doc: ContinuoWorkspaceDoc, trajectory: Trajectory, decision: Decision, plan: TrajectoryPlan): { kind: 'current' } | { kind: 'abandoned' } | { kind: 'elsewhere'; trajectory: Trajectory } | { kind: 'open' } {
  if (choiceOn(trajectory, decision.decisionId)?.planId === plan.planId) return { kind: 'current' };
  if (plan.abandoned !== undefined) return { kind: 'abandoned' };
  const elsewhere = doc.trajectories.findLast((candidate) => candidate.trajectoryId !== trajectory.trajectoryId && candidate.status !== 'abandoned' && choiceOn(candidate, decision.decisionId)?.planId === plan.planId);
  return elsewhere === undefined ? { kind: 'open' } : { kind: 'elsewhere', trajectory: elsewhere };
}
