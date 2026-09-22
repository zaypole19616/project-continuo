import { randomUUID } from 'node:crypto';

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
import { choiceOn, decisionsOn, openDecisionOf, planLetter, planPath, planStatusOn, trajectoryOfSession } from '../../trajectory';
import { currentTaskOf, type ContinuoWorkspaceDoc, type Decision, type TrajectoryPlan } from '../../types';
import { ITrajectoryTool, TRAJECTORY_TOOL_NAME, TrajectoryInputSchema, type TrajectoryInput } from './trajectory';
import DESCRIPTION from './trajectory.md?raw';

export class TrajectoryTool implements ITrajectoryTool {
  declare readonly _serviceBrand: undefined;
  readonly name = TRAJECTORY_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TrajectoryInputSchema);

  constructor(
    @IContinuoStore private readonly store: IContinuoStore,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: TrajectoryInput): ToolExecution {
    return {
      description: args.action === 'propose' ? 'Proposing plans' : args.action === 'expand' ? 'Adding plans' : 'Listing decision points',
      approvalRule: this.name,
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        const trajectory = trajectoryOfSession(doc, this.session.sessionId);
        const task = currentTaskOf(doc, this.session.sessionId);
        if (trajectory === undefined || task === undefined || task.kind !== 'user') return { isError: true, output: 'Decision points belong to a user task; there is none running in this session.' };
        if (args.action === 'list') return { isError: false, output: renderList(doc, trajectory.trajectoryId) };
        const now = new Date().toISOString();
        if (args.action === 'propose') {
          if (args.question === undefined || args.plans === undefined || args.plans.length < 2) return { isError: true, output: 'propose needs a question and at least two plans.' };
          if (openDecisionOf(doc, trajectory, task.taskId) !== undefined) return { isError: true, output: 'A decision point is already open for this task; use expand to add plans to it.' };
          const named = { ...task, name: task.name ?? args.name, category: task.category ?? args.category };
          const plans: TrajectoryPlan[] = args.plans.map((plan, index) => ({ ...plan, planId: planLetter(index), path: planPath(named, planLetter(index), now), createdAt: now }));
          const decision: Decision = { decisionId: `dec_${randomUUID().slice(0, 8)}`, taskId: task.taskId, trajectoryId: trajectory.trajectoryId, question: args.question, turnIndex: Math.max(0, trajectory.turnCount - 1), plans, createdAt: now };
          await this.store.update(doc.workspaceId, (current) => ({
            ...current,
            decisions: [...current.decisions, decision],
            tasks: current.tasks.map((candidate) => (candidate.taskId === task.taskId ? { ...candidate, name: named.name, category: named.category, updatedAt: now } : candidate)),
          }));
          return { isError: false, output: `Decision point recorded with ${plans.length} plans:\n${plans.map((plan) => `- ${plan.planId} ${plan.title} (${plan.path})`).join('\n')}\nEnd your turn now with one short line; the user picks a plan.` };
        }
        const open = openDecisionOf(doc, trajectory, task.taskId);
        if (open === undefined) return { isError: true, output: 'There is no open decision point on this task to expand.' };
        if (args.exhausted !== undefined) {
          const exhausted = { ...args.exhausted, at: now };
          await this.store.update(doc.workspaceId, (current) => ({ ...current, decisions: current.decisions.map((decision) => (decision.decisionId === open.decisionId ? { ...decision, exhausted } : decision)) }));
          return { isError: false, output: 'Recorded that no meaningfully different plan is left. End your turn with the question the user needs to decide.' };
        }
        if (args.plans === undefined || args.plans.length === 0) return { isError: true, output: 'expand needs plans, or exhausted when nothing different is left.' };
        const added: TrajectoryPlan[] = args.plans.map((plan, index) => {
          const planId = planLetter(open.plans.length + index);
          return { ...plan, planId, path: planPath(task, planId, now), createdAt: now };
        });
        await this.store.update(doc.workspaceId, (current) => ({
          ...current,
          decisions: current.decisions.map((decision) => (decision.decisionId === open.decisionId ? { ...decision, plans: [...decision.plans, ...added], turnIndex: Math.max(decision.turnIndex, trajectory.turnCount - 1) } : decision)),
        }));
        return { isError: false, output: `Added ${added.length} plans:\n${added.map((plan) => `- ${plan.planId} ${plan.title} (${plan.path})`).join('\n')}\nEnd your turn now with one short line.` };
      },
    };
  }
}

function renderList(doc: ContinuoWorkspaceDoc, trajectoryId: string): string {
  const trajectory = doc.trajectories.find((candidate) => candidate.trajectoryId === trajectoryId);
  if (trajectory === undefined) return 'No decision points on this line.';
  const decisions = decisionsOn(doc, trajectory);
  if (decisions.length === 0) return 'No decision points on this line.';
  return decisions.map((decision) => {
    const choice = choiceOn(trajectory, decision.decisionId);
    const lines = [`${decision.question}${choice?.text === undefined ? '' : ` — the user gave their own direction: ${choice.text}`}`];
    for (const plan of decision.plans) {
      const status = planStatusOn(doc, trajectory, decision, plan);
      const label = status.kind === 'current' ? 'followed on this line' : status.kind === 'abandoned' ? `abandoned${plan.abandoned?.reason === undefined ? '' : `: ${plan.abandoned.reason}`}` : status.kind === 'elsewhere' ? 'followed on another line' : 'not taken';
      lines.push(`- ${plan.planId} ${plan.title} (${label}) — ${plan.path}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
