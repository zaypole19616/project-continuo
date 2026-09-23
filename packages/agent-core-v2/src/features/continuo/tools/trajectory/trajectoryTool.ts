import { randomUUID } from 'node:crypto';

import type { ToolExecution, ToolResult } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
import { choiceOn, decisionsOn, EXPLORE_MAX_ANGLES, EXPLORE_MAX_STEPS, explorerOf, openDecisionOf, otherLineNote, planLetter, planPath, planStatusOn, trajectoryOfSession } from '../../trajectory';
import { currentTaskOf, type ContinuoWorkspaceDoc, type Decision, type TrajectoryPlan } from '../../types';
import { ITrajectoryTool, TRAJECTORY_TOOL_NAME, TrajectoryInputSchema, type TrajectoryInput } from './trajectory';
import DESCRIPTION from './trajectory.md?raw';

const AUTHOR_ACTIONS = new Set(['submit', 'ask', 'withdraw']);

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
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        const explorer = explorerOf(doc, this.session.sessionId);
        if (explorer !== undefined) {
          if (!AUTHOR_ACTIONS.has(args.action)) return { isError: true, output: 'As a plan author you only submit your plan, ask another author, or withdraw.' };
          return this.author(doc, explorer.decision, explorer.angle.key, args);
        }
        if (AUTHOR_ACTIONS.has(args.action)) return { isError: true, output: 'submit, ask and withdraw are for plan authors during an exploration.' };
        return this.main(doc, args);
      },
    };
  }

  private async main(doc: ContinuoWorkspaceDoc, args: TrajectoryInput): Promise<ToolResult> {
    const trajectory = trajectoryOfSession(doc, this.session.sessionId);
    const task = currentTaskOf(doc, this.session.sessionId);
    if (trajectory === undefined || task === undefined || task.kind !== 'user') return { isError: true, output: 'Decision points belong to a user task; there is none running in this session.' };
    if (args.action === 'list') return { isError: false, output: renderList(doc, trajectory.trajectoryId) };
    const now = new Date().toISOString();
    const named = { ...task, name: task.name ?? args.name, category: task.category ?? args.category };
    const saveNew = async (decision: Decision) => {
      await this.store.update(doc.workspaceId, (current) => ({
        ...current,
        decisions: [...current.decisions, decision],
        tasks: current.tasks.map((candidate) => (candidate.taskId === task.taskId ? { ...candidate, name: named.name, category: named.category, updatedAt: now } : candidate)),
      }));
    };
    if (args.action === 'propose' || args.action === 'explore') {
      if (args.question === undefined) return { isError: true, output: `${args.action} needs a question.` };
      if (openDecisionOf(doc, trajectory, task.taskId) !== undefined) return { isError: true, output: 'A decision point is already open for this task; use expand to add plans to it.' };
      const base = { decisionId: `dec_${randomUUID().slice(0, 8)}`, taskId: task.taskId, trajectoryId: trajectory.trajectoryId, question: args.question, turnIndex: Math.max(0, trajectory.turnCount - 1), createdAt: now };
      if (args.action === 'propose') {
        if (args.plans === undefined || args.plans.length < 2) return { isError: true, output: 'propose needs at least two plans.' };
        const plans: TrajectoryPlan[] = args.plans.map((plan, index) => ({ ...plan, planId: planLetter(index), path: planPath(named, planLetter(index), now), createdAt: now }));
        await saveNew({ ...base, plans });
        return { isError: false, output: `Decision point recorded with ${plans.length} plans:\n${plans.map((plan) => `- ${plan.planId} ${plan.title} (${plan.path})`).join('\n')}\nEnd your turn now with one short line; the user picks a plan.` };
      }
      const angles = args.angles ?? [];
      if (angles.length < 2 || angles.length > EXPLORE_MAX_ANGLES) return { isError: true, output: `explore needs two to ${EXPLORE_MAX_ANGLES} angles.` };
      if (args.reason === undefined) return { isError: true, output: 'explore needs a reason: why each plan needs its own investigation. If it does not, write the plans yourself with propose.' };
      await saveNew({
        ...base,
        plans: [],
        exploration: {
          reason: args.reason,
          angles: angles.map((angle, index) => ({ key: planLetter(index), title: angle.title, angle: angle.angle, status: 'queued', steps: 0 })),
          messages: [],
          maxSteps: EXPLORE_MAX_STEPS,
          startedAt: now,
        },
      });
      return { isError: false, output: `Exploration recorded with ${angles.length} angles. End your turn now with one short line; one author per angle writes a plan in parallel and the plans go to the user.` };
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
  }

  private async author(doc: ContinuoWorkspaceDoc, decision: Decision, key: string, args: TrajectoryInput): Promise<ToolResult> {
    const exploration = decision.exploration!;
    const me = exploration.angles.find((angle) => angle.key === key)!;
    if (me.status === 'submitted' || me.status === 'withdrawn') return { isError: true, output: `Your plan is already ${me.status}; end your turn.` };
    const now = new Date().toISOString();
    if (args.action === 'ask') {
      if (args.to === undefined || args.text === undefined) return { isError: true, output: 'ask needs to and text.' };
      const target = args.to === 'all' ? undefined : exploration.angles.find((angle) => angle.key === args.to);
      if (args.to !== 'all' && (target === undefined || target.key === key)) return { isError: true, output: `Unknown author ${args.to}. Authors: ${exploration.angles.filter((angle) => angle.key !== key).map((angle) => angle.key).join(', ')}.` };
      await this.patch(doc, decision.decisionId, (current) => ({ ...current, exploration: { ...current.exploration!, messages: [...current.exploration!.messages, { from: key, to: args.to!, text: args.text!, at: now }] } }));
      if (target !== undefined && target.status === 'submitted') {
        const plan = decision.plans.find((candidate) => candidate.planId === target.planId);
        return { isError: false, output: `${target.key} has already submitted${plan === undefined ? '' : ` plan ${plan.planId}: ${plan.path}`}. Read it if you need the answer.` };
      }
      if (target !== undefined && (target.status === 'withdrawn' || target.status === 'failed')) return { isError: false, output: `${target.key} is no longer writing a plan.` };
      return { isError: false, output: 'Delivered. A reply, if any, shows up among the messages in your next step; do not wait for it.' };
    }
    if (args.action === 'withdraw') {
      if (args.sameAs === undefined || args.reason === undefined) return { isError: true, output: 'withdraw needs sameAs and reason.' };
      const target = exploration.angles.find((angle) => angle.key === args.sameAs);
      if (target === undefined || target.key === key) return { isError: true, output: `Unknown author ${args.sameAs}.` };
      await this.patch(doc, decision.decisionId, (current) => ({ ...current, exploration: { ...current.exploration!, angles: current.exploration!.angles.map((angle) => (angle.key === key ? { ...angle, status: 'withdrawn', note: `和「${target.title}」重复，${args.reason!}` } : angle)) } }));
      return { isError: false, output: 'Withdrawn. End your turn.' };
    }
    if (args.plan === undefined) return { isError: true, output: 'submit needs your plan.' };
    const task = doc.tasks.find((candidate) => candidate.taskId === decision.taskId);
    let planId = '';
    await this.patch(doc, decision.decisionId, (current) => {
      planId = planLetter(current.plans.length);
      const plan: TrajectoryPlan = { ...args.plan!, planId, path: task === undefined ? `work-log/plan-${planId}.md` : planPath(task, planId, now), createdAt: now };
      return {
        ...current,
        plans: [...current.plans, plan],
        exploration: { ...current.exploration!, angles: current.exploration!.angles.map((angle) => (angle.key === key ? { ...angle, status: 'submitted', planId } : angle)) },
      };
    });
    return { isError: false, output: `Submitted as plan ${planId}. End your turn now with one short line.` };
  }

  private async patch(doc: ContinuoWorkspaceDoc, decisionId: string, mutate: (decision: Decision) => Decision): Promise<void> {
    await this.store.update(doc.workspaceId, (current) => ({ ...current, decisions: current.decisions.map((decision) => (decision.decisionId === decisionId ? mutate(decision) : decision)) }));
  }
}

function describe(args: TrajectoryInput): string {
  switch (args.action) {
    case 'propose': return 'Proposing plans';
    case 'expand': return 'Adding plans';
    case 'explore': return 'Exploring angles in parallel';
    case 'submit': return 'Submitting a plan';
    case 'ask': return `Asking ${args.to ?? 'another author'}`;
    case 'withdraw': return 'Withdrawing a plan';
    default: return 'Listing decision points';
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
      lines.push(`- ${plan.planId} ${plan.title} (${status.kind === 'current' ? 'followed on this line' : otherLineNote(doc, trajectory, decision, plan)}) — ${plan.path}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
