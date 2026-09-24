import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

import { EXPLORE_MAX_ANGLES } from '../../trajectory';
import { planSchema, taskNameSchema } from '../schemas';

export const TRAJECTORY_TOOL_NAME = 'Trajectory';

const proposedPlanSchema = planSchema.extend({
  recommended: z.boolean().optional().describe('true on the one plan you would pick, only when a fact in the materials settles the choice.'),
});

export const TrajectoryInputSchema = z.object({
  action: z
    .enum(['propose', 'expand', 'explore', 'recommend'])
    .describe('propose opens a decision point with plans you write yourself; expand adds plans to the open one or says nothing different is left; explore opens a decision point whose plans are written in parallel, one per angle; recommend states where you stand on the open one.'),
  question: z.string().min(1).max(120).optional().describe('propose / explore: the decision the user has to make, as a short question.'),
  plans: z.array(proposedPlanSchema).max(12).optional().describe('propose / expand: the plans. Each must differ from the others in approach, not in wording.'),
  pick: z.string().min(1).max(8).optional().describe('recommend: the id of the plan you would pick; leave it out when none is clearly better.'),
  why: z.string().min(1).max(300).optional().describe('propose / expand / recommend: one short sentence in the language of the folder, at most about 40 Chinese characters or 25 English words, naming the fact in the materials that makes the plan you recommend the better choice; the user reads it on the card.'),
  dependsOn: z.string().min(1).max(80).optional().describe('propose / recommend: always; expand: when it changes. What the choice comes down to, as one short phrase in the language of the folder, at most about 30 Chinese characters or 15 English words, for example 「更看重现场转化还是长期声量」. It names no plan and no plan letter, does not start with 取决于 or "depends on" (the card adds that), and carries no recommendation: that goes into pick and why.'),
  exhausted: z
    .object({
      reason: z.string().min(1).max(300).describe('Why no meaningfully different plan is left: which directions the existing plans already cover.'),
      ask: z.string().min(1).max(300).describe('The judgment the user needs to make instead, as one question.'),
    })
    .optional()
    .describe('expand: use instead of plans when another plan would only restate an existing one.'),
  angles: z
    .array(z.object({ title: z.string().min(1).max(40).describe('The angle in a few words.'), angle: z.string().min(1).max(400).describe('What this author should look into and argue for.') }))
    .min(2)
    .max(EXPLORE_MAX_ANGLES)
    .optional()
    .describe(`explore: two to ${EXPLORE_MAX_ANGLES} clearly different angles, one author each.`),
  reason: z.string().min(1).max(300).optional().describe('explore: why each plan needs its own investigation instead of you writing them in one go.'),
  name: taskNameSchema.shape.name.optional(),
  category: taskNameSchema.shape.category.optional(),
});

export type TrajectoryInput = z.infer<typeof TrajectoryInputSchema>;

export interface ITrajectoryTool extends AgentTool<TrajectoryInput> {
  readonly _serviceBrand: undefined;
}
export const ITrajectoryTool = createDecorator<ITrajectoryTool>('trajectoryTool');
