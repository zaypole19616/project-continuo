import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const REPORT_RESULT_TOOL_NAME = 'ReportWorkspaceResult';

export const ReportResultInputSchema = z.object({
  summary: z.string().min(1).max(1200).describe('What was done, in two or three sentences.'),
  deliverables: z
    .array(z.object({ path: z.string().min(1).describe('Path relative to the workspace root.'), note: z.string().max(200).optional() }))
    .max(20)
    .describe('Files the user should look at. Use an empty array for answer-only tasks.'),
  unresolved: z.array(z.string().min(1).max(300)).max(10).optional().describe('Open items you could not finish or verify.'),
});

export type ReportResultInput = z.infer<typeof ReportResultInputSchema>;

export interface IReportResultTool extends AgentTool<ReportResultInput> {
  readonly _serviceBrand: undefined;
}
export const IReportResultTool = createDecorator<IReportResultTool>('reportWorkspaceResultTool');
