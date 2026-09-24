import { randomUUID } from 'node:crypto';

import type { ToolExecution, ToolResult } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore, patchDecision } from '../../store';
import { decisionStance, EXPLORE_MAX_ANGLES, EXPLORE_MAX_STEPS, explorerOf, openDecisionOf, planFrom, planIds, planLetter, trajectoryOfSession } from '../../trajectory';
import { currentTaskOf, EMPTY_USAGE, type ContinuoTask, type ContinuoWorkspaceDoc, type Decision, type Trajectory, type TrajectoryPlan } from '../../types';
import { SUBMIT_PLAN_TOOL_NAME } from '../submit-plan/submit-plan';
import { ITrajectoryTool, TRAJECTORY_TOOL_NAME, TrajectoryInputSchema, type TrajectoryInput } from './trajectory';
import DESCRIPTION from './trajectory.md?raw';

type PlanInput = NonNullable<TrajectoryInput['plans']>[number];

export function stopsBatch(args: TrajectoryInput): boolean {
  return args.action !== 'expand' || args.exhausted !== undefined;
}

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
      description: describe(args),
      approvalRule: this.name,
      stopBatchAfterThis: stopsBatch(args),
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        if (explorerOf(doc, this.session.sessionId) !== undefined) return { isError: true, output: `As a plan author you use ${SUBMIT_PLAN_TOOL_NAME}: submit your plan, ask another author, or withdraw.` };
        const trajectory = trajectoryOfSession(doc, this.session.sessionId);
        const task = currentTaskOf(doc, this.session.sessionId);
        if (trajectory === undefined || task === undefined || task.kind !== 'user') return { isError: true, output: 'Decision points belong to a user task; there is none running in this session.' };
        const now = new Date().toISOString();
        switch (args.action) {
          case 'propose': return this.propose(doc, trajectory, task, args, now);
          case 'explore': return this.explore(doc, trajectory, task, args, now);
          case 'recommend':
          case 'expand': {
            const open = openDecisionOf(doc, trajectory, task.taskId);
            if (open === undefined) return { isError: true, output: `There is no open decision point on this task to ${args.action}.` };
            return args.action === 'recommend' ? this.recommend(doc, open, args, now) : this.expand(doc, open, trajectory, task, args, now);
          }
        }
      },
    };
  }

  private async propose(doc: ContinuoWorkspaceDoc, trajectory: Trajectory, task: ContinuoTask, args: TrajectoryInput, now: string): Promise<ToolResult> {
    const base = newDecision(doc, trajectory, task, args, now);
    if (typeof base === 'string') return { isError: true, output: base };
    if (args.plans === undefined || args.plans.length < 2) return { isError: true, output: 'propose needs at least two plans.' };
    const named = namedTask(task, args);
    const nextId = planIds([]);
    const plans = args.plans.map((input) => planFrom(input, nextId(), named, now));
    const stance = decisionStance(recommendedOf(args.plans, plans), args.why, args.dependsOn, now);
    if (typeof stance === 'string') return { isError: true, output: `Nothing recorded. ${stance}` };
    await this.saveNew(doc, named, { ...base, plans, stance }, now);
    return { isError: false, output: `Decision point recorded with ${plans.length} plans:\n${listed(plans)}\nEnd your turn now with one short line; name plans by title, not by letter. The user picks a plan.` };
  }

  private async explore(doc: ContinuoWorkspaceDoc, trajectory: Trajectory, task: ContinuoTask, args: TrajectoryInput, now: string): Promise<ToolResult> {
    const base = newDecision(doc, trajectory, task, args, now);
    if (typeof base === 'string') return { isError: true, output: base };
    if (args.angles === undefined) return { isError: true, output: `explore needs two to ${EXPLORE_MAX_ANGLES} angles.` };
    if (args.reason === undefined) return { isError: true, output: 'explore needs a reason: why each plan needs its own investigation. If it does not, write the plans yourself with propose.' };
    const named = namedTask(task, args);
    await this.saveNew(doc, named, {
      ...base,
      plans: [],
      exploration: {
        reason: args.reason,
        angles: args.angles.map((angle, index) => ({ key: planLetter(index), title: angle.title, angle: angle.angle, status: 'queued', usage: EMPTY_USAGE })),
        messages: [],
        maxSteps: EXPLORE_MAX_STEPS,
        startedAt: now,
      },
    }, now);
    return { isError: false, output: `Exploration recorded with ${args.angles.length} angles. End your turn now with one short line; one author per angle writes a plan in parallel and the plans go to the user.` };
  }

  private async recommend(doc: ContinuoWorkspaceDoc, open: Decision, args: TrajectoryInput, now: string): Promise<ToolResult> {
    if (args.pick !== undefined && !open.plans.some((plan) => plan.planId === args.pick)) return { isError: true, output: `Unknown plan ${args.pick}. Plans: ${open.plans.map((plan) => plan.planId).join(', ')}.` };
    const stance = decisionStance(args.pick === undefined ? [] : [args.pick], args.why, args.dependsOn ?? open.stance?.dependsOn, now);
    if (typeof stance === 'string') return { isError: true, output: stance };
    await patchDecision(this.store, doc.workspaceId, open.decisionId, (current) => ({ ...current, stance }));
    return { isError: false, output: `Recorded that the choice comes down to: ${stance.dependsOn}${stance.pick === undefined ? '' : `, and that you recommend ${stance.pick}`}. End your turn now with one short line; name plans by title, not by letter. The user picks a plan.` };
  }

  private async expand(doc: ContinuoWorkspaceDoc, open: Decision, trajectory: Trajectory, task: ContinuoTask, args: TrajectoryInput, now: string): Promise<ToolResult> {
    if (args.exhausted !== undefined) {
      const exhausted = { ...args.exhausted, at: now };
      await patchDecision(this.store, doc.workspaceId, open.decisionId, (current) => ({ ...current, exhausted }));
      return { isError: false, output: 'Recorded that no meaningfully different plan is left. End your turn with the question the user needs to decide.' };
    }
    if (args.plans === undefined || args.plans.length === 0) return { isError: true, output: 'expand needs plans, or exhausted when nothing different is left.' };
    const nextId = planIds(open.plans.map((plan) => plan.planId));
    const added = args.plans.map((input) => planFrom(input, nextId(), task, now));
    const picks = recommendedOf(args.plans, added);
    const changed = picks.length > 0 || args.dependsOn !== undefined ? decisionStance(picks, args.why, args.dependsOn ?? open.stance?.dependsOn, now) : open.stance;
    if (typeof changed === 'string') return { isError: true, output: `Nothing added. ${changed}` };
    await patchDecision(this.store, doc.workspaceId, open.decisionId, (current) => ({ ...current, plans: [...current.plans, ...added], stance: changed, turnIndex: Math.max(current.turnIndex, trajectory.turnCount - 1) }));
    return { isError: false, output: `Added ${added.length} plans:\n${listed(added)}\nIf the new plans change where you stand, call recommend before ending your turn; otherwise end your turn now with one short line.` };
  }

  private async saveNew(doc: ContinuoWorkspaceDoc, task: ContinuoTask, decision: Decision, now: string): Promise<void> {
    await this.store.update(doc.workspaceId, (current) => ({
      ...current,
      decisions: [...current.decisions, decision],
      tasks: current.tasks.map((candidate) => (candidate.taskId === task.taskId ? { ...candidate, name: task.name, category: task.category, updatedAt: now } : candidate)),
    }));
  }
}

function newDecision(doc: ContinuoWorkspaceDoc, trajectory: Trajectory, task: ContinuoTask, args: TrajectoryInput, now: string): Omit<Decision, 'plans'> | string {
  if (args.question === undefined) return `${args.action} needs a question.`;
  if (openDecisionOf(doc, trajectory, task.taskId) !== undefined) return 'A decision point is already open for this task; use expand to add plans to it.';
  return { decisionId: `dec_${randomUUID().slice(0, 8)}`, taskId: task.taskId, trajectoryId: trajectory.trajectoryId, question: args.question, turnIndex: Math.max(0, trajectory.turnCount - 1), createdAt: now };
}

function namedTask(task: ContinuoTask, args: TrajectoryInput): ContinuoTask {
  return { ...task, name: task.name ?? args.name, category: task.category ?? args.category };
}

function recommendedOf(inputs: readonly PlanInput[], plans: readonly TrajectoryPlan[]): string[] {
  return plans.filter((_, index) => inputs[index]?.recommended === true).map((plan) => plan.planId);
}

function listed(plans: readonly TrajectoryPlan[]): string {
  return plans.map((plan) => `- ${plan.planId} ${plan.title} (${plan.path})`).join('\n');
}

function describe(args: TrajectoryInput): string {
  switch (args.action) {
    case 'propose': return 'Proposing plans';
    case 'expand': return 'Adding plans';
    case 'explore': return 'Exploring angles in parallel';
    case 'recommend': return 'Saying where it stands on the plans';
  }
}
