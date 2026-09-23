import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const WORKSPACE_CONTEXT_TOOL_NAME = 'WorkspaceContext';

export const WorkspaceContextInputSchema = z.object({
  understanding: z
    .string()
    .min(1)
    .max(160)
    .describe('One short sentence in the language of the folder saying what it is for, readable at a glance: at most about 40 Chinese characters or 25 English words. Where things live, conventions and status go into points.'),
  sourceRefs: z
    .array(z.string().min(1))
    .max(8)
    .describe('The guide files this understanding is based on, relative to the folder root.'),
  points: z
    .array(
      z.object({
        text: z.string().min(1).max(200).describe('One sentence a later task needs: a convention, a decision, or where something lives.'),
        sourceRefs: z.array(z.string().min(1)).min(1).max(4).describe('The files this point comes from, relative to the folder root.'),
      }),
    )
    .max(8)
    .optional()
    .describe('Project points, each backed by files you actually read.'),
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1).max(40).describe('What to do, as a short task name in the language of the folder.'),
        reason: z.string().min(1).max(200).describe('Why, with the file or gap that shows it.'),
        prompt: z.string().min(1).max(600).describe('The request that starts it, written as the user would ask it.'),
      }),
    )
    .max(3)
    .optional()
    .describe('Up to three tasks you recommend doing next, most valuable first, each shown by what you read. Leave this out when nothing stands out.'),
});

export type WorkspaceContextInput = z.infer<typeof WorkspaceContextInputSchema>;

export interface IWorkspaceContextTool extends AgentTool<WorkspaceContextInput> {
  readonly _serviceBrand: undefined;
}
export const IWorkspaceContextTool = createDecorator<IWorkspaceContextTool>('workspaceContextTool');
