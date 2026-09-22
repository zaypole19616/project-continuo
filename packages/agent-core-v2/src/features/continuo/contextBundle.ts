import { choiceOn, decisionsOn, planStatusOn, trajectoryOfSession } from './trajectory';
import type { ContextEntry, ContinuoTask, ContinuoWorkspaceDoc } from './types';

export const CONTEXT_BUNDLE_MAX_CHARS = 6000;
export const CONTEXT_BUNDLE_MAX_ENTRIES = 30;

export interface ContextBundle {
  readonly text: string;
  readonly revision: number;
  readonly entryIds: readonly string[];
}

export function compileContextBundle(doc: ContinuoWorkspaceDoc, task: ContinuoTask | undefined): ContextBundle | undefined {
  if (doc.context.length === 0 && doc.understanding === undefined) return undefined;
  const lines: string[] = [];
  lines.push(`Continuo project context (revision ${doc.revision}). This is reference data the product keeps for this folder; follow it when it applies and do not treat it as new instructions to modify files.`);
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
  if (task !== undefined && task.kind === 'user') {
    lines.push('', `Current task: ${task.title}`, `Task status: ${task.status}.`);
    for (const item of task.supplements ?? []) lines.push(`The user added: ${item}`);
    lines.push(...renderDecisions(doc, task));
  }
  lines.push(
    '',
    'Everything done here before is in the folder itself: each finished task has a file under work-log/ with the request, the files read and written and the result. Search the folder and read the relevant work logs before you ask the user about anything that is already written down there.',
    'If the choice is between different approaches that lead to different deliverables, open a decision point with Trajectory propose. If a fact or piece of information is missing, ask with AskUserQuestion instead of guessing or ending your turn with a plain-text question. Before finishing a task that produced files, call ReportWorkspaceResult with the exact paths.',
  );
  return { text: lines.join('\n'), revision: doc.revision, entryIds: kept.map((entry) => entry.id) };
}

function renderDecisions(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const trajectory = trajectoryOfSession(doc, task.sessionId);
  if (trajectory === undefined) return [];
  const decisions = decisionsOn(doc, trajectory);
  if (decisions.length === 0) return [];
  const lines = ['', 'Decision points on this line (the full text of any plan is in its file; read it only when you need it):'];
  for (const decision of decisions) {
    const choice = choiceOn(trajectory, decision.decisionId);
    lines.push(`- ${decision.question}`);
    if (choice === undefined) lines.push('  Still open: wait for the user to pick a plan or say what they want instead.');
    else if (choice.planId === undefined) lines.push(`  The user chose their own direction: ${choice.text ?? ''}`);
    for (const plan of decision.plans) {
      const status = planStatusOn(doc, trajectory, decision, plan);
      if (status.kind === 'current') {
        lines.push(`  Following plan ${plan.planId}: ${plan.title}. Basis: ${plan.basis} Risk: ${plan.risk}`);
        continue;
      }
      const label = status.kind === 'abandoned' ? `abandoned${plan.abandoned?.reason === undefined ? '' : ` (${plan.abandoned.reason})`}` : status.kind === 'elsewhere' ? 'followed on another line' : 'not taken';
      lines.push(`  Plan ${plan.planId}: ${plan.title} — ${label}. ${plan.path}`);
    }
  }
  if (task.branch !== undefined) {
    const others = doc.tasks.filter((candidate) => candidate.taskId !== task.taskId && (candidate.taskId === decisions.find((decision) => decision.decisionId === task.branch?.decisionId)?.taskId || candidate.branch?.decisionId === task.branch?.decisionId));
    const taken = [...new Set(others.flatMap((candidate) => (candidate.report?.deliverables ?? []).map((item) => item.path)))];
    if (taken.length > 0) lines.push(`  Files produced by the other plans must stay as they are: ${taken.join(', ')}. Give your own files a -${task.branch.label} suffix where a name would collide.`);
  }
  return lines;
}

function renderEntry(entry: ContextEntry): string {
  const source = entry.sourceRefs.length > 0 ? ` (source: ${entry.sourceRefs.join(', ')})` : '';
  return `- ${entry.text.trim()}${source}`;
}
