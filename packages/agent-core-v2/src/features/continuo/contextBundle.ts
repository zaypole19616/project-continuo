import { join, relative } from 'node:path';

import { choiceOn, decisionsOn, doneOnLine, explorerOf, lineOfSession, lineSuffix, otherLineNote, planStatusOn, rootOfTask, writtenPaths } from './trajectory';
import { currentTaskOf, type ContextEntry, type ContinuoTask, type ContinuoWorkspaceDoc, type Decision, type ExplorationAngle, type Trajectory } from './types';

export const CONTEXT_BUNDLE_MAX_CHARS = 6000;
export const CONTEXT_BUNDLE_MAX_ENTRIES = 30;
export const CONTEXT_BUNDLE_MAX_DONE = 12;
export const CONTEXT_BUNDLE_MAX_FOREIGN = 20;

export function compileContextBundle(doc: ContinuoWorkspaceDoc, sessionId: string): string | undefined {
  const explorer = explorerOf(doc, sessionId);
  const task = explorer === undefined ? currentTaskOf(doc, sessionId) : undefined;
  if (task?.kind === 'init') return undefined;
  if (doc.context.length === 0 && doc.understanding === undefined && explorer === undefined) return undefined;
  const lines: string[] = ['Continuo project context for this folder. The product keeps it up to date; it is reference, not a new request from the user.'];
  if (doc.understanding !== undefined) {
    lines.push('', 'What this folder is:', doc.understanding.text.trim());
  }
  const kept: ContextEntry[] = [];
  let budget = CONTEXT_BUNDLE_MAX_CHARS - lines.join('\n').length;
  for (const entry of doc.context) {
    if (kept.length >= CONTEXT_BUNDLE_MAX_ENTRIES) break;
    const line = renderEntry(entry);
    if (line.length > budget) continue;
    kept.push(entry);
    budget -= line.length + 1;
  }
  if (kept.length > 0) {
    lines.push('', 'Project points recorded when this folder was first read:');
    for (const entry of kept) lines.push(renderEntry(entry));
  }
  const line = explorer === undefined && task === undefined ? undefined : lineOfSession(doc, sessionId);
  if (line !== undefined && line.workDir === undefined && explorer === undefined) lines.push(...renderSharedFolder(doc, line));
  if (line?.workDir !== undefined) {
    lines.push('', `Working directory of this line: ${line.workDir}. It is a copy of the project made when this line branched off. Read and write with absolute paths under it, run shell commands with cwd set to it, and report deliverables relative to it; its work-log/ holds this line's history. Files elsewhere in the project belong to other lines: nothing here is merged back into them, and access outside this directory is refused.`);
  }
  if (explorer !== undefined) {
    lines.push(...renderExplorer(explorer.decision, explorer.angle));
    return lines.join('\n');
  }
  if (task !== undefined && task.kind === 'user') {
    lines.push('', `Current task: ${task.title}`, `Task status: ${task.status}.`);
    for (const item of task.supplements ?? []) lines.push(`The user added: ${item}`);
    if (line !== undefined) lines.push(...renderDone(doc, line, task), ...renderDecisions(doc, line));
  }
  return lines.join('\n');
}

function renderSharedFolder(doc: ContinuoWorkspaceDoc, line: Trajectory): string[] {
  const own = new Set(line.taskIds);
  const foreign = [...new Set(doc.tasks
    .filter((task) => task.kind === 'user' && !own.has(task.taskId) && rootOfTask(doc, task) === doc.root)
    .flatMap((task) => [...writtenPaths(doc, task), ...(task.logPath === undefined ? [] : [join(doc.root, task.logPath)])])
    .map((path) => relative(doc.root, path)))];
  const others = doc.trajectories.some((other) => other.trajectoryId !== line.trajectoryId && other.status !== 'abandoned');
  if (!others && foreign.length === 0) return [];
  const suffix = lineSuffix(doc, line);
  const lines = ['', 'Other lines of this project work in this same folder.'];
  if (foreign.length > 0) {
    const shown = foreign.slice(0, CONTEXT_BUNDLE_MAX_FOREIGN);
    lines.push(`Files they wrote are not part of this line's work; read them only if the user asks: ${shown.join(', ')}${foreign.length > shown.length ? `, and ${foreign.length - shown.length} more` : ''}.`);
  }
  if (others) lines.push(`When you copy a file to change it, add "-${suffix}" to the copy's name (for example notes-${suffix}.md).`);
  return lines;
}

function renderDone(doc: ContinuoWorkspaceDoc, line: Trajectory, task: ContinuoTask): string[] {
  const done = doneOnLine(doc, line, task.taskId);
  if (done.length === 0) return [];
  const shown = done.slice(-CONTEXT_BUNDLE_MAX_DONE);
  const lines = ['', 'Done on this line (the work logs have the details):'];
  if (done.length > shown.length) lines.push(`- ${done.length - shown.length} earlier tasks, see work-log/`);
  for (const item of shown) lines.push(`- ${item.name}${item.deliverables.length === 0 ? '' : ` → ${item.deliverables.join(', ')}`}`);
  return lines;
}

function renderDecisions(doc: ContinuoWorkspaceDoc, line: Trajectory): string[] {
  const decisions = decisionsOn(doc, line);
  if (decisions.length === 0) return [];
  const lines = ['', 'Decision points on this line:'];
  for (const decision of decisions) {
    const choice = choiceOn(line, decision.decisionId);
    lines.push(`- ${decision.question}`);
    if (choice === undefined) lines.push(decision.exploration !== undefined && decision.exploration.endedAt === undefined ? '  Plans are still being written in parallel.' : '  Still open: the user has not picked a plan yet.');
    else if (choice.planId === undefined) lines.push(`  The user chose their own direction: ${choice.text ?? ''}`);
    for (const plan of decision.plans) {
      if (planStatusOn(doc, line, decision, plan).kind === 'current') {
        lines.push(`  Following 「${plan.title}」 (id ${plan.planId}). Basis: ${plan.basis} Risk: ${plan.risk}`);
        continue;
      }
      lines.push(`  「${plan.title}」 (id ${plan.planId}) — ${otherLineNote(doc, line, decision, plan)}. ${plan.path}`);
    }
  }
  return lines;
}

function renderExplorer(decision: Decision, angle: ExplorationAngle): string[] {
  const exploration = decision.exploration!;
  const others = exploration.angles.filter((candidate) => candidate.key !== angle.key);
  const inbox = exploration.messages.filter((message) => message.to === angle.key || (message.to === 'all' && message.from !== angle.key));
  const lines = [
    '',
    `You are the author of plan ${angle.key} for the decision point "${decision.question}".`,
    `Your angle: ${angle.title} — ${angle.angle}`,
    `Step budget: ${exploration.maxSteps} steps.`,
  ];
  if (others.length > 0) {
    lines.push('Other authors writing in parallel:');
    for (const other of others) lines.push(`- ${other.key} ${other.title} — ${other.angle}${other.status === 'submitted' && other.planId !== undefined ? ` (submitted as plan ${other.planId})` : other.status === 'withdrawn' ? ' (withdrawn)' : ''}`);
  }
  if (inbox.length > 0) {
    lines.push('Messages for you:');
    for (const message of inbox) lines.push(`- from ${message.from}: ${message.text}`);
  }
  return lines;
}

function renderEntry(entry: ContextEntry): string {
  const source = entry.sourceRefs.length > 0 ? ` (source: ${entry.sourceRefs.join(', ')})` : '';
  return `- ${entry.text.trim()}${source}`;
}
