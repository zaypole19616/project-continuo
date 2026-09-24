import { currentTrajectory, type ContinuoTask, type ContinuoWorkspaceDoc, type Decision, type IContinuoStore, type Trajectory, type TrajectoryPlan } from '@moonshot-ai/agent-core-v2';

import { ContinuoError } from './errors';

export type TaskMutator = (task: ContinuoTask) => ContinuoTask;

export async function requireDoc(store: IContinuoStore, workspaceId: string): Promise<ContinuoWorkspaceDoc> {
  const doc = await store.load(workspaceId);
  if (doc === undefined) throw new ContinuoError('workspace_not_found', '这个项目还没有打开过。');
  return doc;
}

export function requireTask(doc: ContinuoWorkspaceDoc, taskId: string): ContinuoTask {
  const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) throw new ContinuoError('task_not_found', '这件事找不到了。');
  return task;
}

export function requireCurrent(doc: ContinuoWorkspaceDoc): Trajectory {
  const line = currentTrajectory(doc);
  if (line === undefined) throw new ContinuoError('invalid_state', '这个项目还没有轨迹。');
  return line;
}

export function requireDecision(doc: ContinuoWorkspaceDoc, decisionId: string): Decision {
  const decision = doc.decisions.find((candidate) => candidate.decisionId === decisionId);
  if (decision === undefined) throw new ContinuoError('invalid_state', '这个决策找不到了。');
  return decision;
}

export function requirePlan(decision: Decision, planId: string): TrajectoryPlan {
  const plan = decision.plans.find((candidate) => candidate.planId === planId);
  if (plan === undefined) throw new ContinuoError('invalid_state', '这个方案找不到了。');
  return plan;
}

export function patchTaskIn(doc: ContinuoWorkspaceDoc, taskId: string, mutate: TaskMutator): ContinuoWorkspaceDoc {
  const now = new Date().toISOString();
  let changed = false;
  const tasks = doc.tasks.map((task) => {
    if (task.taskId !== taskId) return task;
    const next = mutate(task);
    if (next === task) return task;
    changed = true;
    return { ...next, updatedAt: now };
  });
  return changed ? { ...doc, tasks } : doc;
}

export function patchTask(store: IContinuoStore, workspaceId: string, taskId: string, mutate: TaskMutator): Promise<ContinuoWorkspaceDoc> {
  return store.update(workspaceId, (current) => patchTaskIn(current, taskId, mutate));
}
