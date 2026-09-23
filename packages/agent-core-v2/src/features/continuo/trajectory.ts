import { extname, isAbsolute, join } from 'node:path';

import { isWithinDirectory } from '#/tool/path-access';

import type { ContinuoTask, ContinuoWorkspaceDoc, Decision, DecisionStance, ExplorationAngle, Trajectory, TrajectoryChoice, TrajectoryPlan } from './types';

export const WORK_LOG_DIR = 'work-log';
export const CONTINUO_DIR = '.continuo';
export const LINES_DIR = `${CONTINUO_DIR}/lines`;
export const EXPLORE_MAX_ANGLES = 4;
export const EXPLORE_MAX_STEPS = 8;

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

export function decisionStance(picks: readonly string[], why: string | undefined, dependsOn: string | undefined, at: string): DecisionStance | string {
  if (dependsOn === undefined) return 'Always give dependsOn: what the choice comes down to, as one short phrase.';
  if (picks.length > 1) return 'Recommend at most one plan, or none.';
  if (picks.length === 0) return { dependsOn, at };
  return why === undefined ? 'The recommended plan needs why: the fact in the materials that settles it.' : { dependsOn, pick: picks[0], why, at };
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

export function lineById(doc: ContinuoWorkspaceDoc, trajectoryId: string): Trajectory | undefined {
  return doc.trajectories.find((trajectory) => trajectory.trajectoryId === trajectoryId);
}

export function lineRoot(doc: ContinuoWorkspaceDoc, line: Trajectory | undefined): string {
  return line?.workDir ?? doc.root;
}

export function rootOfTask(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string {
  return lineRoot(doc, trajectoryOfSession(doc, task.sessionId));
}

export function explorerOf(doc: ContinuoWorkspaceDoc, sessionId: string): { decision: Decision; angle: ExplorationAngle } | undefined {
  for (const decision of doc.decisions) {
    const angle = decision.exploration?.angles.find((candidate) => candidate.sessionId === sessionId);
    if (angle !== undefined) return { decision, angle };
  }
  return undefined;
}

export function isExploring(decision: Decision): boolean {
  return decision.exploration !== undefined && decision.exploration.endedAt === undefined;
}

export interface GuardedAccess {
  readonly operation: string;
  readonly path: string;
}

export function writtenPaths(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const root = rootOfTask(doc, task);
  const paths = [...(task.report?.deliverables ?? []).map((item) => item.path), ...(task.rounds ?? []).flatMap((round) => round.writes)];
  return [...new Set(paths.map((path) => (isAbsolute(path) ? path : join(root, path))))];
}

export function lineSuffix(doc: ContinuoWorkspaceDoc, line: Trajectory): string {
  if (line.origin === undefined) return '原轨迹';
  if (line.origin.planId !== undefined) return `方案${line.origin.planId}`;
  return `分支${doc.trajectories.findIndex((candidate) => candidate.trajectoryId === line.trajectoryId) + 1}`;
}

export function variantPath(path: string, suffix: string): string {
  const ext = extname(path);
  return `${path.slice(0, path.length - ext.length)}-${suffix}${ext}`;
}

function writtenByOtherLine(doc: ContinuoWorkspaceDoc, line: Trajectory, path: string): boolean {
  return doc.tasks.some((task) => task.kind === 'user' && !line.taskIds.includes(task.taskId) && writtenPaths(doc, task).includes(path));
}

export function guardAccesses(doc: ContinuoWorkspaceDoc, sessionId: string, accesses: readonly GuardedAccess[], existing: ReadonlySet<string>): string | undefined {
  const explorer = explorerOf(doc, sessionId);
  const line = explorer === undefined ? trajectoryOfSession(doc, sessionId) : lineById(doc, explorer.decision.trajectoryId);
  if (line === undefined) return undefined;
  const root = lineRoot(doc, line);
  const hidden = join(doc.root, CONTINUO_DIR);
  const isWrite = (access: GuardedAccess) => access.operation === 'write' || access.operation === 'readwrite';
  if (explorer !== undefined && accesses.some(isWrite)) {
    return 'As the author of one plan you only write the plan: submit it with Trajectory submit. Do not create or change project files.';
  }
  const blocked = accesses.filter((access) => {
    const inLine = isWithinDirectory(access.path, root);
    const inHidden = isWithinDirectory(access.path, hidden);
    if (isWrite(access)) return !inLine || (root === doc.root && inHidden);
    if (!isWithinDirectory(access.path, doc.root)) return false;
    return root === doc.root ? inHidden : !inLine;
  });
  if (blocked.length === 0 && line.workDir === undefined) {
    const foreign = accesses.find((access) => isWrite(access) && existing.has(access.path) && writtenByOtherLine(doc, line, access.path));
    if (foreign === undefined) return undefined;
    return `${foreign.path} was written on another line of this project and stays as it is. Copy it to ${variantPath(foreign.path, lineSuffix(doc, line))} and change the copy instead, then report that path.`;
  }
  if (blocked.length === 0) return undefined;
  const paths = [...new Set(blocked.map((access) => access.path))].join(', ');
  if (root === doc.root && blocked.some((access) => isWithinDirectory(access.path, hidden))) return `${hidden} holds Continuo's own records and stays as it is. Denied: ${paths}.`;
  if (root === doc.root) return `Work on this project stays inside its folder, ${doc.root}; files outside it are not changed. Denied: ${paths}.`;
  return `This line works in its own directory: ${root}, a copy of the project made when it branched off. Nothing here is ever merged back into other lines, and this line can never change their files. Read and write only inside it, with absolute paths under it; if the user asked for a file elsewhere in the project, tell them plainly that this line cannot write there and where the file is in this line. Denied: ${paths}.`;
}

export function guardTool(doc: ContinuoWorkspaceDoc, sessionId: string, name: string, cwd: string | undefined): string | undefined {
  if (explorerOf(doc, sessionId) !== undefined) {
    if (name === 'AskUserQuestion') return 'As the author of one plan you do not ask the user. Ask another author with Trajectory ask, or write the assumption into your plan.';
    if (name === 'Bash') return 'As the author of one plan you do not run shell commands. Read the materials with Read, Grep and Glob, then submit your plan with Trajectory submit.';
    return undefined;
  }
  if (name !== 'Bash') return undefined;
  const line = trajectoryOfSession(doc, sessionId);
  if (line?.workDir === undefined) return undefined;
  if (cwd !== undefined && isWithinDirectory(cwd, line.workDir)) return undefined;
  return `This line works in its own directory: ${line.workDir}, and nothing in it is merged back into other lines. Run shell commands with cwd set to that directory (or a folder inside it), and keep every path they touch inside it.`;
}

export function doneOnLine(doc: ContinuoWorkspaceDoc, line: Trajectory, exceptTaskId: string | undefined): Array<{ name: string; deliverables: string[] }> {
  return line.taskIds
    .filter((taskId) => taskId !== exceptTaskId)
    .map((taskId) => doc.tasks.find((task) => task.taskId === taskId))
    .filter((task): task is ContinuoTask => task !== undefined && (task.status === 'completed' || task.status === 'needs_review'))
    .map((task) => ({ name: taskName(task), deliverables: (task.report?.deliverables ?? []).filter((item) => item.exists !== false).map((item) => item.path) }));
}

export function otherLineNote(doc: ContinuoWorkspaceDoc, line: Trajectory, decision: Decision, plan: TrajectoryPlan): string {
  const status = planStatusOn(doc, line, decision, plan);
  if (status.kind === 'abandoned') return `abandoned${plan.abandoned?.reason === undefined ? '' : ` because ${plan.abandoned.reason}`}`;
  if (status.kind !== 'elsewhere') return 'not taken';
  const own = new Set(line.taskIds);
  const tasks = status.trajectory.taskIds.filter((taskId) => !own.has(taskId)).map((taskId) => doc.tasks.find((task) => task.taskId === taskId)).filter((task): task is ContinuoTask => task !== undefined);
  const rounds = tasks.reduce((total, task) => total + (task.rounds ?? []).length, 0);
  const produced = [...new Set(tasks.flatMap((task) => (task.report?.deliverables ?? []).map((item) => item.path)))];
  return `followed on another line: ${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${rounds} round${rounds === 1 ? '' : 's'}${produced.length === 0 ? '' : `, produced ${produced.join(', ')}`}`;
}
