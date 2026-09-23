import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const TRAJECTORY_TOOL_NAME = 'Trajectory';

const planSchema = z.object({
  title: z.string().min(1).max(40).describe('The plan in a few words.'),
  basis: z.string().min(1).max(300).describe('Which material or fact makes this plan reasonable.'),
  risk: z.string().min(1).max(300).describe('The main way this plan could go wrong or what it gives up.'),
  prompt: z.string().min(1).max(800).describe('The instruction that starts this plan if the user picks it, written as the user would say it.'),
  detail: z.string().max(4000).optional().describe('The fuller plan in Markdown: steps, what gets produced, open points. Written into the plan file.'),
});

export const TrajectoryInputSchema = z.object({
  action: z
    .enum(['propose', 'expand', 'explore', 'list', 'submit', 'ask', 'withdraw'])
    .describe('Main agent: propose opens a decision point with plans you write yourself; expand adds plans to the open one or says nothing different is left; explore opens a decision point whose plans are written in parallel, one per angle; list shows the decision points on this line. Plan author: submit hands in your plan; ask sends a question to another author; withdraw drops your plan because it is the same as another one.'),
  question: z.string().min(1).max(120).optional().describe('propose / explore: the decision the user has to make, as a short question.'),
  plans: z.array(planSchema).max(12).optional().describe('propose / expand: the plans. Each must differ from the others in approach, not in wording.'),
  exhausted: z
    .object({
      reason: z.string().min(1).max(300).describe('Why no meaningfully different plan is left: which directions the existing plans already cover.'),
      ask: z.string().min(1).max(300).describe('The judgment the user needs to make instead, as one question.'),
    })
    .optional()
    .describe('expand: use instead of plans when another plan would only restate an existing one.'),
  angles: z
    .array(z.object({ title: z.string().min(1).max(40).describe('The angle in a few words.'), angle: z.string().min(1).max(400).describe('What this author should look into and argue for.') }))
    .max(6)
    .optional()
    .describe('explore: two to four clearly different angles, one author each.'),
  reason: z.string().min(1).max(300).optional().describe('explore: why each plan needs its own investigation instead of you writing them in one go. withdraw: why your plan is the same as the other one.'),
  plan: planSchema.optional().describe('submit: your plan.'),
  to: z.string().min(1).max(8).optional().describe('ask: the key of the author you ask (for example B), or all.'),
  text: z.string().min(1).max(600).optional().describe('ask: the question or answer.'),
  sameAs: z.string().min(1).max(8).optional().describe('withdraw: the key of the author whose plan yours duplicates.'),
  name: z.string().min(1).max(12).optional().describe('propose / explore: the task name, two to six characters, if you have not reported it yet.'),
  category: z.string().min(1).max(24).regex(/^[a-z][a-z0-9-]*$/).optional().describe('propose / explore: the task category as a lowercase ASCII word.'),
});

export type TrajectoryInput = z.infer<typeof TrajectoryInputSchema>;

export interface ITrajectoryTool extends AgentTool<TrajectoryInput> {
  readonly _serviceBrand: undefined;
}
export const ITrajectoryTool = createDecorator<ITrajectoryTool>('trajectoryTool');
