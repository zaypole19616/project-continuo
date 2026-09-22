import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
import { currentTaskOf } from '../../types';
import { IReportResultTool, REPORT_RESULT_TOOL_NAME, ReportResultInputSchema, type ReportResultInput } from './report-result';
import DESCRIPTION from './report-result.md?raw';

export class ReportResultTool implements IReportResultTool {
  declare readonly _serviceBrand: undefined;
  readonly name = REPORT_RESULT_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ReportResultInputSchema);

  constructor(
    @IContinuoStore private readonly store: IContinuoStore,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: ReportResultInput): ToolExecution {
    return {
      description: args.deliverables.length > 0 ? `Reporting ${args.deliverables.length} deliverable(s)` : 'Reporting task result',
      approvalRule: this.name,
      execute: async () => {
        const doc = await this.store.load(this.session.workspaceId);
        const task = doc === undefined ? undefined : currentTaskOf(doc, this.session.sessionId);
        if (doc === undefined || task === undefined) {
          return { isError: true, output: 'No Continuo task is bound to this session; nothing recorded.' };
        }
        const reportedAt = new Date().toISOString();
        await this.store.update(doc.workspaceId, (current) => ({
          ...current,
          tasks: current.tasks.map((candidate) =>
            candidate.taskId === task.taskId
              ? {
                  ...candidate,
                  name: args.name,
                  category: args.category,
                  report: {
                    summary: args.summary,
                    deliverables: args.deliverables.map((item) => ({ path: item.path, note: item.note })),
                    unresolved: joinFragments(args.unresolved ?? []),
                    nextStep: args.nextStep,
                    reportedAt,
                  },
                  updatedAt: reportedAt,
                }
              : candidate,
          ),
        }));
        return { isError: false, output: 'Result recorded; the product will verify the reported paths when the turn ends.' };
      },
    };
  }
}

const SENTENCE_END = /[。！？!?.；;]["'」』）)]?$/;

function joinFragments(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (text.length === 0) continue;
    const previous = out.at(-1);
    if (previous !== undefined && !SENTENCE_END.test(previous)) out[out.length - 1] = `${previous}${text}`;
    else out.push(text);
  }
  return out;
}
