import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const WORKSPACE_CONTEXT_TOOL_NAME = 'WorkspaceContext';

const kindSchema = z.enum(['convention', 'background', 'decision', 'progress', 'material']);

export const WorkspaceContextInputSchema = z.object({
  action: z.enum(['list', 'propose', 'apply_user_instruction', 'deactivate', 'set_understanding']).describe('What to do.'),
  kind: kindSchema.optional().describe('Entry kind for propose / apply_user_instruction.'),
  text: z.string().min(1).max(600).optional().describe('Entry text, or the understanding summary for set_understanding.'),
  scope: z.enum(['workspace', 'task']).optional().describe('Where the entry applies. Defaults to workspace.'),
  sourceRefs: z.array(z.string().min(1)).max(8).optional().describe('Files this is based on, relative to the workspace root.'),
  quote: z.string().max(400).optional().describe("The user's own words for apply_user_instruction."),
  supersedes: z.string().optional().describe('Entry id that this instruction replaces.'),
  entryId: z.string().optional().describe('Entry id for deactivate.'),
});

export type WorkspaceContextInput = z.infer<typeof WorkspaceContextInputSchema>;

export interface IWorkspaceContextTool extends AgentTool<WorkspaceContextInput> {
  readonly _serviceBrand: undefined;
}
export const IWorkspaceContextTool = createDecorator<IWorkspaceContextTool>('workspaceContextTool');
