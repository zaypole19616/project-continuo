import { randomUUID } from 'node:crypto';

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
import type { ContextEntry } from '../../types';
import {
  IWorkspaceContextTool,
  WORKSPACE_CONTEXT_TOOL_NAME,
  WorkspaceContextInputSchema,
  type WorkspaceContextInput,
} from './workspace-context';
import DESCRIPTION from './workspace-context.md?raw';

export class WorkspaceContextTool implements IWorkspaceContextTool {
  declare readonly _serviceBrand: undefined;
  readonly name = WORKSPACE_CONTEXT_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WorkspaceContextInputSchema);

  constructor(
    @IContinuoStore private readonly store: IContinuoStore,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: WorkspaceContextInput): ToolExecution {
    return {
      description: 'Recording what this folder is',
      approvalRule: this.name,
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) {
          return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        }
        const now = new Date().toISOString();
        const context: ContextEntry[] = (args.points ?? []).map((point) => ({
          id: `ctx_${randomUUID().slice(0, 8)}`,
          text: point.text,
          sourceRefs: point.sourceRefs,
          createdAt: now,
        }));
        await this.store.update(doc.workspaceId, (current) => ({
          ...current,
          understanding: { text: args.understanding, sourceRefs: args.sourceRefs, suggestions: args.suggestions, updatedAt: now },
          context,
        }));
        return { isError: false, output: `Recorded the understanding of this folder, ${context.length} project points and ${args.suggestions?.length ?? 0} suggestions.` };
      },
    };
  }
}
