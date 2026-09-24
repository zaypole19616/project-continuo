import { createHash } from 'node:crypto';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Service } from '#/_base/di/service';
import { IAgentReminderService } from '#/features/reminder/reminderService';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { compileContextBundle } from './contextBundle';
import { IContinuoStore } from './store';

export const CONTINUO_REMINDER_VARIANT = 'continuo';

export interface ContinuoDisclosure {
  readonly digest: string;
}

export interface IAgentContinuoBridge {
  readonly _serviceBrand: undefined;
}

export const IAgentContinuoBridge: ServiceIdentifier<IAgentContinuoBridge> =
  createDecorator<IAgentContinuoBridge>('agentContinuoBridge');

export function bundleDigest(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export function shouldInject(lastDisclosure: ContinuoDisclosure | undefined, digest: string, isNewTurn: boolean): boolean {
  return isNewTurn || lastDisclosure?.digest !== digest;
}

export class AgentContinuoBridgeService extends Service implements IAgentContinuoBridge {
  declare readonly _serviceBrand: undefined;

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
        const text = compileContextBundle(doc, this.session.sessionId);
        if (text === undefined) return undefined;
        const digest = bundleDigest(text);
        if (!shouldInject(lastDisclosure, digest, isNewTurn)) return undefined;
        return { content: text, disclosure: { digest } };
      }),
    );
  }
}
