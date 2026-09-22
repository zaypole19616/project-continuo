import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const WORKSPACE_CONTEXT_TOOL_NAME = 'WorkspaceContext';

export const WorkspaceContextInputSchema = z.object({
  understanding: z
    .string()
    .min(1)
    .max(600)
    .describe('Two or three sentences in the language of the folder: what it is for, where inputs live, where results go, what is archive rather than current.'),
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
});

export type WorkspaceContextInput = z.infer<typeof WorkspaceContextInputSchema>;

export interface IWorkspaceContextTool extends AgentTool<WorkspaceContextInput> {
  readonly _serviceBrand: undefined;
}
export const IWorkspaceContextTool = createDecorator<IWorkspaceContextTool>('workspaceContextTool');
