import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Service } from '#/_base/di/service';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { denyToolExecution } from '#/agent/toolExecutor/beforeToolExecuteEvent';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import type { ToolFileAccess } from '#/tool/toolContract';

import { CONTINUO_WORKER_PROFILE } from './profile/continuoWorker';
import { IContinuoStore } from './store';
import { guardAccesses, guardTool } from './trajectory';

const GUARDED_TOOLS = new Set(['Bash', 'AskUserQuestion']);

export interface IAgentContinuoGuard {
  readonly _serviceBrand: undefined;
}

export const IAgentContinuoGuard: ServiceIdentifier<IAgentContinuoGuard> = createDecorator<IAgentContinuoGuard>('agentContinuoGuard');

export class AgentContinuoGuardService extends Service implements IAgentContinuoGuard {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAgentToolExecutorService executor: IAgentToolExecutorService,
    @IAgentProfileService profile: IAgentProfileService,
    @IAgentToolApprovalService approval: IAgentToolApprovalService,
    @ISessionContext session: ISessionContext,
    @IContinuoStore store: IContinuoStore,
  ) {
    super();
    this._register(
      executor.onBeforeExecuteTool(async (event) => {
        if (profile.data().profileName !== CONTINUO_WORKER_PROFILE) return;
        const accesses = (event.execution.accesses ?? []).filter((access): access is ToolFileAccess => access.kind === 'file');
        if (accesses.length === 0 && !GUARDED_TOOLS.has(event.toolCall.name)) return;
        const doc = await store.load(session.workspaceId);
        if (doc === undefined) return;
        const cwd = (event.args as { cwd?: unknown } | undefined)?.cwd;
        const denied = guardTool(doc, session.sessionId, event.toolCall.name, typeof cwd === 'string' ? cwd : undefined)
          ?? (accesses.length === 0 ? undefined : guardAccesses(doc, session.sessionId, accesses));
        if (denied !== undefined) event.veto(denyToolExecution(approval.formatDenyMessage(denied)));
      }),
    );
  }
}
