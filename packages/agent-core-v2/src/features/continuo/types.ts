export const CONTINUO_SCHEMA_VERSION = 1;
export const CONTINUO_STORE_SCOPE = 'continuo-workspace';

export type ContextKind = 'convention' | 'background' | 'decision' | 'progress' | 'material';
export type ContextOrigin = 'user' | 'file' | 'agent';
export type ContextStatus = 'candidate' | 'active' | 'stale' | 'superseded' | 'inactive';

export interface ContextScope {
  readonly type: 'workspace' | 'task';
  readonly taskId?: string;
}

export interface ContextEntry {
  readonly id: string;
  readonly kind: ContextKind;
  readonly text: string;
  readonly scope: ContextScope;
  readonly sourceRefs: readonly string[];
  readonly sourceFingerprint?: string;
  readonly origin: ContextOrigin;
  readonly status: ContextStatus;
  readonly revision: number;
  readonly supersedes?: string;
  readonly taskId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TaskKind = 'init' | 'user';
export type TaskTrigger = 'first_open' | 'user' | 'resume' | 'reopen' | 'reply' | 'demo';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_user'
  | 'verifying'
  | 'completed'
  | 'needs_review'
  | 'paused'
  | 'failed'
  | 'interrupted';

export interface TaskUsage {
  readonly steps: number;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
}

export interface TaskDeliverable {
  readonly path: string;
  readonly note?: string;
  readonly exists?: boolean;
  readonly turnId?: number;
}

export interface TaskNextStep {
  readonly title: string;
  readonly reason: string;
  readonly prompt: string;
}

export interface TaskReport {
  readonly summary: string;
  readonly deliverables: readonly TaskDeliverable[];
  readonly unresolved: readonly string[];
  readonly nextStep?: TaskNextStep;
  readonly reportedAt: string;
}

export interface ContinuoTask {
  readonly taskId: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly trigger: TaskTrigger;
  readonly sessionId: string;
  readonly promptIds: readonly string[];
  readonly status: TaskStatus;
  readonly phase?: string;
  readonly pauseRequested: boolean;
  readonly contextRevision: number;
  readonly pendingInteraction?: 'question' | 'approval' | 'reply' | 'none';
  readonly lastReply?: string;
  readonly report?: TaskReport;
  readonly verification?: readonly string[];
  readonly supplements?: readonly string[];
  readonly sources?: readonly string[];
  readonly usage: TaskUsage;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
}

export interface ActivityEntry {
  readonly at: string;
  readonly taskId?: string;
  readonly kind: 'task' | 'tool' | 'context' | 'system' | 'user';
  readonly text: string;
}

export interface ScanEntry {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly size?: number;
  readonly ext?: string;
}

export interface WorkspaceScan {
  readonly scannedAt: string;
  readonly entries: readonly ScanEntry[];
  readonly guideFiles: readonly string[];
  readonly truncated: boolean;
  readonly unscanned: readonly string[];
  readonly counts: { readonly dirs: number; readonly files: number; readonly byExt: Readonly<Record<string, number>> };
}

export type InitStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped';

export interface WorkspaceUnderstanding {
  readonly text: string;
  readonly sourceRefs: readonly string[];
  readonly updatedAt: string;
}

export interface ContinuoWorkspaceDoc {
  readonly schemaVersion: number;
  readonly workspaceId: string;
  readonly root: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly openCount: number;
  readonly init: { readonly status: InitStatus; readonly fingerprint?: string; readonly taskId?: string; readonly startedAt?: string; readonly endedAt?: string };
  readonly scan?: WorkspaceScan;
  readonly understanding?: WorkspaceUnderstanding;
  readonly context: readonly ContextEntry[];
  readonly tasks: readonly ContinuoTask[];
  readonly activity: readonly ActivityEntry[];
}

export const EMPTY_USAGE: TaskUsage = { steps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

export function newWorkspaceDoc(workspaceId: string, root: string): ContinuoWorkspaceDoc {
  const now = new Date().toISOString();
  return {
    schemaVersion: CONTINUO_SCHEMA_VERSION,
    workspaceId,
    root,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    openCount: 0,
    init: { status: 'pending' },
    context: [],
    tasks: [],
    activity: [],
  };
}

export function isEffectiveEntry(entry: ContextEntry, taskId: string | undefined): boolean {
  if (entry.status !== 'active') return false;
  if (entry.scope.type === 'workspace') return true;
  return taskId !== undefined && entry.scope.taskId === taskId;
}
