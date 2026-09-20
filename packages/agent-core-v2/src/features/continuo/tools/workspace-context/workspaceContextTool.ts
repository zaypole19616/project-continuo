import { randomUUID } from 'node:crypto';

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
import { isEffectiveEntry, type ContextEntry, type ContinuoWorkspaceDoc } from '../../types';
import {
  IWorkspaceContextTool,
  WORKSPACE_CONTEXT_TOOL_NAME,
  WorkspaceContextInputSchema,
  type WorkspaceContextInput,
} from './workspace-context';
import DESCRIPTION from './workspace-context.md?raw';

const GUIDE_FILE_PATTERN = /(^|\/)(readme|agents|claude)(\.[a-z0-9]+)?$/i;

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
      description: describe(args),
      approvalRule: this.name,
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) {
          return { isError: true, output: 'This workspace has no Continuo state; open it through Continuo first.' };
        }
        const taskId = doc.tasks.find((task) => task.sessionId === this.session.sessionId)?.taskId;
        switch (args.action) {
          case 'list':
            return { isError: false, output: renderList(doc, taskId) };
          case 'set_understanding': {
            if (args.text === undefined) return { isError: true, output: 'text is required.' };
            const text = args.text;
            const sourceRefs = args.sourceRefs ?? [];
            await this.store.update(doc.workspaceId, (current) => ({
              ...current,
              understanding: { text, sourceRefs, updatedAt: new Date().toISOString() },
              activity: [...current.activity, { at: new Date().toISOString(), taskId, kind: 'context', text: 'Workspace understanding updated' }],
            }));
            return { isError: false, output: 'Understanding recorded.' };
          }
          case 'propose':
          case 'apply_user_instruction': {
            if (args.text === undefined || args.kind === undefined) return { isError: true, output: 'kind and text are required.' };
            const sourceRefs = args.sourceRefs ?? [];
            const fromGuide = sourceRefs.some((ref) => GUIDE_FILE_PATTERN.test(ref));
            const isUser = args.action === 'apply_user_instruction';
            if (isUser && (args.quote === undefined || args.quote.trim().length === 0)) {
              return { isError: true, output: "quote is required: include the user's own words." };
            }
            const scopeType = args.scope ?? 'workspace';
            const entry: ContextEntry = {
              id: `ctx_${randomUUID().slice(0, 8)}`,
              kind: args.kind,
              text: args.text,
              scope: scopeType === 'task' ? { type: 'task', taskId } : { type: 'workspace' },
              sourceRefs: isUser && args.quote !== undefined ? [...sourceRefs, `user: "${args.quote.trim()}"`] : sourceRefs,
              origin: isUser ? 'user' : fromGuide ? 'file' : 'agent',
              status: isUser || fromGuide ? 'active' : 'candidate',
              revision: 1,
              supersedes: args.supersedes,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            const supersedes = args.supersedes;
            const updated = await this.store.update(doc.workspaceId, (current) => ({
              ...current,
              context: [
                ...current.context.map((existing) =>
                  supersedes !== undefined && existing.id === supersedes && existing.status !== 'superseded'
                    ? { ...existing, status: 'superseded' as const, updatedAt: new Date().toISOString() }
                    : existing,
                ),
                entry,
              ],
              activity: [
                ...current.activity,
                { at: new Date().toISOString(), taskId, kind: 'context', text: `${entry.status === 'active' ? 'Recorded' : 'Proposed'} ${entry.kind}: ${entry.text}` },
              ],
            }));
            const verb = entry.status === 'active' ? 'is now effective' : 'is recorded as a candidate pending user confirmation';
            const superseded = supersedes !== undefined && updated.context.some((e) => e.id === supersedes && e.status === 'superseded') ? ` Entry ${supersedes} no longer applies.` : '';
            return { isError: false, output: `Entry ${entry.id} ${verb}.${superseded}` };
          }
          case 'deactivate': {
            const entryId = args.entryId;
            if (entryId === undefined) return { isError: true, output: 'entryId is required.' };
            if (!doc.context.some((entry) => entry.id === entryId)) return { isError: true, output: `Unknown entry ${entryId}.` };
            await this.store.update(doc.workspaceId, (current) => ({
              ...current,
              context: current.context.map((entry) => (entry.id === entryId ? { ...entry, status: 'inactive' as const, updatedAt: new Date().toISOString() } : entry)),
              activity: [...current.activity, { at: new Date().toISOString(), taskId, kind: 'context', text: `Deactivated ${entryId}` }],
            }));
            return { isError: false, output: `Entry ${entryId} deactivated.` };
          }
        }
      },
    };
  }
}

function describe(args: WorkspaceContextInput): string {
  switch (args.action) {
    case 'list': return 'Reading workspace context';
    case 'propose': return `Proposing ${args.kind ?? 'context'}`;
    case 'apply_user_instruction': return 'Recording user instruction';
    case 'deactivate': return 'Deactivating context entry';
    case 'set_understanding': return 'Updating workspace understanding';
  }
}

function renderList(doc: ContinuoWorkspaceDoc, taskId: string | undefined): string {
  const lines: string[] = [];
  if (doc.understanding !== undefined) lines.push(`Understanding: ${doc.understanding.text}`);
  const effective = doc.context.filter((entry) => isEffectiveEntry(entry, taskId));
  const candidates = doc.context.filter((entry) => entry.status === 'candidate');
  lines.push(`Effective entries (${effective.length}):`);
  for (const entry of effective) lines.push(`- [${entry.id}] ${entry.kind}: ${entry.text}${entry.sourceRefs.length ? ` (source: ${entry.sourceRefs.join(', ')})` : ''}`);
  if (candidates.length > 0) {
    lines.push(`Candidates awaiting confirmation (${candidates.length}):`);
    for (const entry of candidates) lines.push(`- [${entry.id}] ${entry.kind}: ${entry.text}`);
  }
  return lines.join('\n');
}
