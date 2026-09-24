import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

import { planSchema } from '../schemas';

export const SUBMIT_PLAN_TOOL_NAME = 'SubmitPlan';

export const SubmitPlanInputSchema = z.object({
  action: z
    .enum(['submit', 'ask', 'withdraw'])
    .describe('submit hands in your plan; ask sends a question to another author; withdraw drops your plan because it is the same as another one.'),
  plan: planSchema.optional().describe('submit: your plan.'),
  to: z.string().min(1).max(8).optional().describe('ask: the key of the author you ask (for example B), or all.'),
  text: z.string().min(1).max(600).optional().describe('ask: the question or answer.'),
  sameAs: z.string().min(1).max(8).optional().describe('withdraw: the key of the author whose plan yours duplicates.'),
  reason: z.string().min(1).max(300).optional().describe('withdraw: why your plan is the same as the other one.'),
});

export type SubmitPlanInput = z.infer<typeof SubmitPlanInputSchema>;

export interface ISubmitPlanTool extends AgentTool<SubmitPlanInput> {
  readonly _serviceBrand: undefined;
}
export const ISubmitPlanTool = createDecorator<ISubmitPlanTool>('submitPlanTool');
