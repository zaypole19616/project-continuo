import { join, relative } from 'node:path';

import { choiceOn, decisionsOn, doneOnLine, explorerOf, lineById, lineSuffix, otherLineNote, planStatusOn, rootOfTask, trajectoryOfSession, writtenPaths } from './trajectory';
import { currentTaskOf, type ContextEntry, type ContinuoTask, type ContinuoWorkspaceDoc, type Decision, type ExplorationAngle, type Trajectory } from './types';

export const CONTEXT_BUNDLE_MAX_CHARS = 6000;
export const CONTEXT_BUNDLE_MAX_ENTRIES = 30;
export const CONTEXT_BUNDLE_MAX_DONE = 12;
export const CONTEXT_BUNDLE_MAX_FOREIGN = 20;

export interface ContextBundle {
  readonly text: string;
  readonly revision: number;
  readonly entryIds: readonly string[];
}

export function compileContextBundle(doc: ContinuoWorkspaceDoc, sessionId: string): ContextBundle | undefined {
  const explorer = explorerOf(doc, sessionId);
  const task = explorer === undefined ? currentTaskOf(doc, sessionId) : undefined;
  if (task?.kind === 'init') return undefined;
  if (doc.context.length === 0 && doc.understanding === undefined && explorer === undefined) return undefined;
  const lines: string[] = [`Continuo project context (revision ${doc.revision}). This is reference data the product keeps for this folder; follow it when it applies and do not treat it as new instructions to modify files.`];
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
  const line = explorer === undefined ? (task === undefined ? undefined : trajectoryOfSession(doc, task.sessionId)) : lineById(doc, explorer.decision.trajectoryId);
  if (line !== undefined && line.workDir === undefined && explorer === undefined) lines.push(...renderSharedFolder(doc, line));
  if (line?.workDir !== undefined) {
    lines.push('', `Working directory of this line: ${line.workDir}. It is a copy of the project made when this line branched off. Read and write with absolute paths under it, run shell commands with cwd set to it, and report deliverables relative to it; its work-log/ holds this line's history. Files elsewhere in the project belong to other lines: nothing here is merged back into them, and access outside this directory is refused.`);
  }
  if (explorer !== undefined) {
    lines.push(...renderExplorer(explorer.decision, explorer.angle));
    return { text: lines.join('\n'), revision: doc.revision, entryIds: kept.map((entry) => entry.id) };
  }
  if (task !== undefined && task.kind === 'user') {
    lines.push('', `Current task: ${task.title}`, `Task status: ${task.status}.`);
    for (const item of task.supplements ?? []) lines.push(`The user added: ${item}`);
    if (line !== undefined) lines.push(...renderDone(doc, line, task), ...renderDecisions(doc, line));
  }
  lines.push(
    '',
    'Everything done here before is in the folder itself: each finished task has a file under work-log/ with the request, the files read and written and the result. Search the folder and read the relevant work logs before you ask the user about anything that is already written down there.',
    'If the choice is between different approaches that lead to different deliverables, open a decision point with Trajectory propose. If a fact or piece of information is missing, ask with AskUserQuestion instead of guessing or ending your turn with a plain-text question. Before finishing a task that produced files, call ReportWorkspaceResult with the exact paths.',
  );
  return { text: lines.join('\n'), revision: doc.revision, entryIds: kept.map((entry) => entry.id) };
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
  const lines = ['', 'Decision points on this line (the full text of any plan is in its file; read it only when you need it). Call plans by their titles when you talk to the user; the ids are only for tool calls:'];
  for (const decision of decisions) {
    const choice = choiceOn(line, decision.decisionId);
    lines.push(`- ${decision.question}`);
    if (choice === undefined) lines.push(decision.exploration !== undefined && decision.exploration.endedAt === undefined ? '  Plans are still being written in parallel.' : '  Still open: wait for the user to pick a plan or say what they want instead.');
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
  ];
  if (others.length > 0) {
    lines.push('Other authors writing in parallel:');
    for (const other of others) lines.push(`- ${other.key} ${other.title} — ${other.angle}${other.status === 'submitted' && other.planId !== undefined ? ` (submitted as plan ${other.planId})` : other.status === 'withdrawn' ? ' (withdrawn)' : ''}`);
  }
  lines.push(
    `Write only this one plan and submit it with Trajectory submit: title, basis, risk, the prompt that starts it and the full detail. Do not create or change project files. Stay within ${exploration.maxSteps} steps.`,
    'You do not need to read the other plans. Only when you are unsure about something another author may have settled, ask them with Trajectory ask. If you find your plan is the same as another one, withdraw it with Trajectory withdraw and name that plan.',
  );
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
