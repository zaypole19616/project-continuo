import type { ToolExecution, ToolResult } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore, patchDecision } from '../../store';
import { explorerOf, planFrom } from '../../trajectory';
import type { ContinuoWorkspaceDoc, Decision, ExplorationAngle } from '../../types';
import { TRAJECTORY_TOOL_NAME } from '../trajectory/trajectory';
import { ISubmitPlanTool, SUBMIT_PLAN_TOOL_NAME, SubmitPlanInputSchema, type SubmitPlanInput } from './submit-plan';
import DESCRIPTION from './submit-plan.md?raw';

export class SubmitPlanTool implements ISubmitPlanTool {
  declare readonly _serviceBrand: undefined;
  readonly name = SUBMIT_PLAN_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SubmitPlanInputSchema);

  constructor(
    @IContinuoStore private readonly store: IContinuoStore,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: SubmitPlanInput): ToolExecution {
    return {
      description: describe(args),
      approvalRule: this.name,
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        const explorer = explorerOf(doc, this.session.sessionId);
        if (explorer === undefined) return { isError: true, output: `${SUBMIT_PLAN_TOOL_NAME} is for plan authors during an exploration; as the main agent, open decision points with ${TRAJECTORY_TOOL_NAME}.` };
        const { decision, angle } = explorer;
        if (angle.status === 'submitted' || angle.status === 'withdrawn') return { isError: true, output: `Your plan is already ${angle.status}; end your turn.` };
        const now = new Date().toISOString();
        switch (args.action) {
          case 'ask': return this.ask(doc, decision, angle, args, now);
          case 'withdraw': return this.withdraw(doc, decision, angle, args);
          case 'submit': return this.submit(doc, decision, angle, args, now);
        }
      },
    };
  }

  private async ask(doc: ContinuoWorkspaceDoc, decision: Decision, me: ExplorationAngle, args: SubmitPlanInput, now: string): Promise<ToolResult> {
    if (args.to === undefined || args.text === undefined) return { isError: true, output: 'ask needs to and text.' };
    const authors = decision.exploration!.angles;
    const target = args.to === 'all' ? undefined : authors.find((angle) => angle.key === args.to);
    if (args.to !== 'all' && (target === undefined || target.key === me.key)) return { isError: true, output: `Unknown author ${args.to}. Authors: ${authors.filter((angle) => angle.key !== me.key).map((angle) => angle.key).join(', ')}.` };
    const message = { from: me.key, to: args.to, text: args.text, at: now };
    await patchDecision(this.store, doc.workspaceId, decision.decisionId, (current) => ({ ...current, exploration: { ...current.exploration!, messages: [...current.exploration!.messages, message] } }));
    if (target !== undefined && target.status === 'submitted') {
      const plan = decision.plans.find((candidate) => candidate.planId === target.planId);
      return { isError: false, output: `${target.key} has already submitted${plan === undefined ? '' : ` plan ${plan.planId}: ${plan.path}`}. Read it if you need the answer.` };
    }
    if (target !== undefined && (target.status === 'withdrawn' || target.status === 'failed')) return { isError: false, output: `${target.key} is no longer writing a plan.` };
    return { isError: false, output: 'Delivered. A reply, if any, shows up among the messages in your next step; do not wait for it.' };
  }

  private async withdraw(doc: ContinuoWorkspaceDoc, decision: Decision, me: ExplorationAngle, args: SubmitPlanInput): Promise<ToolResult> {
    if (args.sameAs === undefined || args.reason === undefined) return { isError: true, output: 'withdraw needs sameAs and reason.' };
    const target = decision.exploration!.angles.find((angle) => angle.key === args.sameAs);
    if (target === undefined || target.key === me.key) return { isError: true, output: `Unknown author ${args.sameAs}.` };
    const note = `和「${target.title}」重复，${args.reason}`;
    await patchDecision(this.store, doc.workspaceId, decision.decisionId, (current) => ({ ...current, exploration: { ...current.exploration!, angles: current.exploration!.angles.map((angle) => (angle.key === me.key ? { ...angle, status: 'withdrawn', note } : angle)) } }));
    return { isError: false, output: 'Withdrawn. End your turn.' };
  }

  private async submit(doc: ContinuoWorkspaceDoc, decision: Decision, me: ExplorationAngle, args: SubmitPlanInput, now: string): Promise<ToolResult> {
    if (args.plan === undefined) return { isError: true, output: 'submit needs your plan.' };
    const task = doc.tasks.find((candidate) => candidate.taskId === decision.taskId);
    if (task === undefined) return { isError: true, output: 'The task of this decision point is gone; end your turn.' };
    const plan = planFrom(args.plan, me.key, task, now);
    await patchDecision(this.store, doc.workspaceId, decision.decisionId, (current) => ({
      ...current,
      plans: [...current.plans, plan],
      exploration: { ...current.exploration!, angles: current.exploration!.angles.map((angle) => (angle.key === me.key ? { ...angle, status: 'submitted', planId: plan.planId } : angle)) },
    }));
    return { isError: false, output: `Submitted as plan ${plan.planId}. End your turn now with one short line.` };
  }
}

function describe(args: SubmitPlanInput): string {
  switch (args.action) {
    case 'submit': return 'Submitting a plan';
    case 'ask': return `Asking ${args.to ?? 'another author'}`;
    case 'withdraw': return 'Withdrawing a plan';
  }
}
