import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Service } from '#/_base/di/service';
import { IAgentReminderService } from '#/features/reminder/reminderService';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { compileContextBundle } from './contextBundle';
import { currentTaskOf } from './types';
import { IContinuoStore } from './store';

export const CONTINUO_REMINDER_VARIANT = 'continuo';

export interface ContinuoDisclosure {
  readonly revision: number;
}

export interface IAgentContinuoBridge {
  readonly _serviceBrand: undefined;
  readonly lastRevision: number | undefined;
}

export const IAgentContinuoBridge: ServiceIdentifier<IAgentContinuoBridge> =
  createDecorator<IAgentContinuoBridge>('agentContinuoBridge');

export class AgentContinuoBridgeService extends Service implements IAgentContinuoBridge {
  declare readonly _serviceBrand: undefined;

  lastRevision: number | undefined;

  constructor(
    @IAgentReminderService reminder: IAgentReminderService,
    @ISessionContext private readonly session: ISessionContext,
    @IContinuoStore private readonly store: IContinuoStore,
  ) {
    super();
    this._register(
      reminder.register<ContinuoDisclosure>(CONTINUO_REMINDER_VARIANT, async ({ isNewTurn, lastDisclosure }) => {
        const doc = await this.store.load(this.session.workspaceId);
        if (doc === undefined) return undefined;
        const task = currentTaskOf(doc, this.session.sessionId);
        if (task !== undefined && task.kind === 'init') return undefined;
        const bundle = compileContextBundle(doc, task);
        if (bundle === undefined) return undefined;
        const changed = lastDisclosure?.revision !== bundle.revision;
        if (!isNewTurn && !changed) return undefined;
        this.lastRevision = bundle.revision;
        return { content: bundle.text, disclosure: { revision: bundle.revision } };
      }),
    );
  }
}
