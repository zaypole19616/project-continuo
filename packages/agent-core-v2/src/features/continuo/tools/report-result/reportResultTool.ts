import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { IContinuoStore } from '../../store';
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
        const task = doc?.tasks.find((candidate) => candidate.sessionId === this.session.sessionId);
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
                  report: {
                    summary: args.summary,
                    deliverables: args.deliverables.map((item) => ({ path: item.path, note: item.note })),
                    unresolved: args.unresolved ?? [],
                    nextStep: args.nextStep,
                    reportedAt,
                  },
                  updatedAt: reportedAt,
                }
              : candidate,
          ),
          activity: [...current.activity, { at: reportedAt, taskId: task.taskId, kind: 'task', text: `上报结果：${args.deliverables.length} 份产物${(args.unresolved ?? []).length > 0 ? `，${(args.unresolved ?? []).length} 项未完成` : ''}` }],
        }));
        return { isError: false, output: 'Result recorded; the product will verify the reported paths when the turn ends.' };
      },
    };
  }
}
