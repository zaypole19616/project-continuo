import { ScopeActivation } from '#/_base/di/instantiation';
import { IFlagService } from '#/app/flag/flag';
import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { AgentContinuoBridgeService, IAgentContinuoBridge } from './bridge';
import { ContinuoStoreService, IContinuoStore } from './store';
import { IReportResultTool, REPORT_RESULT_TOOL_NAME } from './tools/report-result/report-result';
import { ReportResultTool } from './tools/report-result/reportResultTool';
import { IWorkspaceContextTool, WORKSPACE_CONTEXT_TOOL_NAME } from './tools/workspace-context/workspace-context';
import { WorkspaceContextTool } from './tools/workspace-context/workspaceContextTool';

import { CONTINUO_FLAG_ID } from './flag';
import './profile/continuoInit';
import './profile/continuoWorker';

export class ContinuoFeature extends Feature {
  static override readonly name = 'continuo';

  constructor(@IFlagService flags: IFlagService) {
    super();
    if (!flags.enabled(CONTINUO_FLAG_ID)) return;
    this.contributeService(LifecycleScope.App, IContinuoStore, ContinuoStoreService, {
      activation: ScopeActivation.OnDemand,
    });
    this.contributeAgentService(IAgentContinuoBridge, AgentContinuoBridgeService, {
      activation: ScopeActivation.OnScopeCreated,
    });
    this.contributeTool(IWorkspaceContextTool, WorkspaceContextTool, {
      name: WORKSPACE_CONTEXT_TOOL_NAME,
      domain: 'continuo',
    });
    this.contributeTool(IReportResultTool, ReportResultTool, {
      name: REPORT_RESULT_TOOL_NAME,
      domain: 'continuo',
    });
  }
}

registerFeature(ContinuoFeature);
