import {
  CONTINUO_INIT_PROFILE,
  ErrorCodes,
  IAgentLifecycleService,
  IAgentLoopService,
  IAgentProfileService,
  IConfigService,
  IContinuoStore,
  IEventBus,
  ISessionActivityView,
  ISessionContext,
  ISessionManager,
  PROMPT_CACHE_KEY_METADATA,
  getLiveSessionById,
  isError2,
  resumeSessionById,
  type ContinuoPermissionMode,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type IAgentScopeHandle,
  type ISessionScopeHandle,
  type Scope,
} from '@moonshot-ai/agent-core-v2';
import { ulid } from 'ulid';

import { ensureMainAgent } from '../transport/mainAgent';
import { patchTask, requireDoc, requireTask } from './doc';
import { ContinuoError } from './errors';
import type { MainTurn } from './prompts';
import { toAwaiting } from './taskState';

export interface Attachment {
  readonly dispose: () => void;
  readonly writes: Map<string, { path: string; turnId?: number }>;
  readonly sessionId: string;
  readonly reads: Set<string>;
  reply: string;
  prompt: string;
  turnIndex?: number;
}

export type AgentEventHandler = (workspaceId: string, taskId: string, event: Record<string, unknown>) => Promise<void>;

export const NO_MODEL = '请先用 Kimi 账号登录，再回来重试。';
const MISSING_TASK_SESSION = '这件事的对话记录找不到了。';
const FORK_RETRIES = 25;

function modelError(error: unknown): unknown {
  return error instanceof Error && /model is required/i.test(error.message) ? new ContinuoError('invalid_state', NO_MODEL) : error;
}

async function mainAgentOf(session: ISessionScopeHandle): Promise<IAgentScopeHandle> {
  try {
    return await ensureMainAgent(session);
  } catch (error) {
    throw modelError(error);
  }
}

export class Workers {
  private readonly attachments = new Map<string, Attachment>();

  constructor(private readonly core: Scope, private readonly onEvent: AgentEventHandler) {}

  private get store(): IContinuoStore {
    return this.core.accessor.get(IContinuoStore);
  }

  has(taskId: string): boolean {
    return this.attachments.has(taskId);
  }

  attachmentOf(taskId: string): Attachment | undefined {
    return this.attachments.get(taskId);
  }

  isLive(taskId: string | undefined, doc: ContinuoWorkspaceDoc): boolean {
    if (taskId === undefined) return false;
    const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
    return task !== undefined && this.attachments.has(taskId) && getLiveSessionById(this.core.accessor, task.sessionId) !== undefined;
  }

  async newSession(workspaceId: string, workDir: string, profile: string): Promise<ISessionScopeHandle> {
    try {
      return await this.core.accessor.get(ISessionManager).create({ workspaceId, workDir, mainAgentBinding: { profile } });
    } catch (error) {
      throw modelError(error);
    }
  }

  async newInitAgent(workspaceId: string, root: string): Promise<{ session: ISessionScopeHandle; agent: IAgentScopeHandle }> {
    const session = await this.newSession(workspaceId, root, CONTINUO_INIT_PROFILE);
    const agent = await mainAgentOf(session);
    agent.accessor.get(IAgentLifecycleService).broadcastPermissionMode('auto');
    return { session, agent };
  }

  async openSession(sessionId: string, missing: string): Promise<ISessionScopeHandle> {
    const session = await resumeSessionById(this.core.accessor, sessionId);
    if (session === undefined) throw new ContinuoError('invalid_state', missing);
    return session;
  }

  async prepare(session: ISessionScopeHandle, workspaceId: string, mode?: ContinuoPermissionMode): Promise<IAgentScopeHandle> {
    const agent = await mainAgentOf(session);
    const profile = agent.accessor.get(IAgentProfileService);
    if (profile.data().modelAlias === undefined) {
      const alias = this.core.accessor.get(IConfigService).get<string | undefined>('defaultModel');
      if (alias !== undefined && alias !== '') await profile.setModel(alias);
    }
    const permission = mode ?? (await requireDoc(this.store, workspaceId)).permissionMode ?? 'manual';
    agent.accessor.get(IAgentLifecycleService).broadcastPermissionMode(permission);
    return agent;
  }

  async attachWorker(workspaceId: string, task: ContinuoTask): Promise<IAgentScopeHandle> {
    const session = await this.openSession(task.sessionId, MISSING_TASK_SESSION);
    const agent = await this.prepare(session, workspaceId);
    this.attach(workspaceId, task.taskId, session, agent);
    return agent;
  }

  attach(workspaceId: string, taskId: string, session: ISessionScopeHandle, agent: IAgentScopeHandle): void {
    this.attachments.get(taskId)?.dispose();
    const sessionId = session.accessor.get(ISessionContext).sessionId;
    for (const [other, attachment] of this.attachments) {
      if (attachment.sessionId !== sessionId || other === taskId) continue;
      attachment.dispose();
      this.attachments.delete(other);
    }
    const events = agent.accessor.get(IEventBus);
    const activity = session.accessor.get(ISessionActivityView);
    const onEvent = events.subscribe((event) => { void this.onEvent(workspaceId, taskId, event as unknown as Record<string, unknown>); });
    const onActivity = activity.onDidChange((change) => {
      void patchTask(this.store, workspaceId, taskId, (current) => {
        if (current.status !== 'running' && current.status !== 'awaiting_user') return current;
        const pending = change.state.pendingInteraction;
        if (pending !== 'none') return toAwaiting(current, pending, pending === 'question' ? '等待你回答' : '等待你批准');
        if (current.status === 'awaiting_user' && change.state.busy) return { ...current, status: 'running', pendingInteraction: 'none', phase: undefined };
        return current;
      });
    });
    this.attachments.set(taskId, { dispose: () => { onEvent.dispose(); onActivity.dispose(); }, writes: new Map(), reads: new Set(), reply: '', prompt: '', sessionId });
  }

  async cancel(sessionId: string, reason: string): Promise<boolean> {
    const session = await resumeSessionById(this.core.accessor, sessionId);
    if (session === undefined) return false;
    const agent = await mainAgentOf(session);
    return agent.accessor.get(IAgentLoopService).cancel(undefined, reason);
  }

  async broadcastPermissionMode(sessionId: string, mode: ContinuoPermissionMode): Promise<void> {
    const session = getLiveSessionById(this.core.accessor, sessionId);
    if (session === undefined) return;
    (await mainAgentOf(session)).accessor.get(IAgentLifecycleService).broadcastPermissionMode(mode);
  }

  async forkWhenIdle(doc: ContinuoWorkspaceDoc, sourceSessionId: string, turnIndex: number, title: string): Promise<{ id: string }> {
    const cacheKey = doc.trajectories.find((line) => line.origin === undefined)?.sessionId ?? sourceSessionId;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.core.accessor.get(ISessionManager).fork({ sourceSessionId, turnIndex, title, metadata: { [PROMPT_CACHE_KEY_METADATA]: cacheKey } });
      } catch (error) {
        if (attempt >= FORK_RETRIES || !(isError2(error) && error.code === ErrorCodes.SESSION_FORK_ACTIVE_TURN)) throw error;
        await new Promise((done) => { setTimeout(done, 200); });
      }
    }
  }

  async sendTurn(workspaceId: string, taskId: string, agent: IAgentScopeHandle, turn: MainTurn): Promise<string> {
    const task = requireTask(await requireDoc(this.store, workspaceId), taskId);
    let turnIndex: number | undefined;
    await this.store.update(workspaceId, (current) => ({
      ...current,
      trajectories: current.trajectories.map((candidate) => {
        if (candidate.sessionId !== task.sessionId) return candidate;
        turnIndex = candidate.turnCount;
        return { ...candidate, turnCount: candidate.turnCount + 1 };
      }),
    }));
    const attachment = this.attachments.get(taskId);
    if (attachment !== undefined) attachment.turnIndex = turnIndex;
    return this.submitPrompt(agent, taskId, turn.text, turn.round);
  }

  submitPrompt(agent: IAgentScopeHandle, taskId: string, text: string, round: string): string {
    const attachment = this.attachments.get(taskId);
    if (attachment !== undefined) attachment.prompt = round;
    return this.submit(agent, text);
  }

  async steer(sessionId: string, text: string): Promise<boolean> {
    const session = getLiveSessionById(this.core.accessor, sessionId);
    if (session === undefined) return false;
    const agent = await mainAgentOf(session);
    if (agent.accessor.get(IAgentLoopService).snapshot().state !== 'running') return false;
    this.submit(agent, text, true);
    return true;
  }

  submit(agent: IAgentScopeHandle, text: string, steerIfActive = false): string {
    const promptId = `msg_${ulid()}`;
    agent.accessor.get(IAgentLoopService).submit({
      message: { role: 'user', content: [{ type: 'text', text }] },
      meta: { promptId, origin: { kind: 'user' }, tracked: true },
    } as Parameters<IAgentLoopService['submit']>[0], { steerIfActive });
    return promptId;
  }
}
