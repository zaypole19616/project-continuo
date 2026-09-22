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
  action: z.enum(['propose', 'expand', 'list']).describe('propose opens a decision point with plans; expand adds plans to the open one or says nothing different is left; list shows the decision points on this line.'),
  question: z.string().min(1).max(120).optional().describe('propose: the decision the user has to make, as a short question.'),
  plans: z.array(planSchema).max(12).optional().describe('propose / expand: the plans. Each must differ from the others in approach, not in wording.'),
  exhausted: z
    .object({
      reason: z.string().min(1).max(300).describe('Why no meaningfully different plan is left: which directions the existing plans already cover.'),
      ask: z.string().min(1).max(300).describe('The judgment the user needs to make instead, as one question.'),
    })
    .optional()
    .describe('expand: use instead of plans when another plan would only restate an existing one.'),
  name: z.string().min(1).max(12).optional().describe('propose: the task name, two to six characters, if you have not reported it yet.'),
  category: z.string().min(1).max(24).regex(/^[a-z][a-z0-9-]*$/).optional().describe('propose: the task category as a lowercase ASCII word.'),
});

export type TrajectoryInput = z.infer<typeof TrajectoryInputSchema>;

export interface ITrajectoryTool extends AgentTool<TrajectoryInput> {
  readonly _serviceBrand: undefined;
}
export const ITrajectoryTool = createDecorator<ITrajectoryTool>('trajectoryTool');
