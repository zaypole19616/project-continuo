export const CONTINUO_SCHEMA_VERSION = 4;
export const CONTINUO_STORE_SCOPE = 'continuo-workspace';

export interface ContextEntry {
  readonly id: string;
  readonly text: string;
  readonly sourceRefs: readonly string[];
  readonly createdAt: string;
}

export type TaskKind = 'init' | 'user';
export type TaskTrigger = 'first_open' | 'user' | 'resume' | 'reply' | 'plan';
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

export interface TaskRound {
  readonly at: string;
  readonly prompt: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly reply: string;
  readonly turnIndex?: number;
}

export interface TrajectoryPlan {
  readonly planId: string;
  readonly title: string;
  readonly basis: string;
  readonly risk: string;
  readonly prompt: string;
  readonly detail?: string;
  readonly path: string;
  readonly abandoned?: { readonly reason?: string; readonly at: string };
  readonly createdAt: string;
}

export type AngleStatus = 'queued' | 'running' | 'submitted' | 'withdrawn' | 'failed';

export interface ExplorationAngle {
  readonly key: string;
  readonly title: string;
  readonly angle: string;
  readonly status: AngleStatus;
  readonly sessionId?: string;
  readonly planId?: string;
  readonly note?: string;
  readonly steps: number;
  readonly usage?: TaskUsage;
}

export interface ExplorationMessage {
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly at: string;
}

export interface Exploration {
  readonly reason: string;
  readonly angles: readonly ExplorationAngle[];
  readonly messages: readonly ExplorationMessage[];
  readonly maxSteps: number;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface Decision {
  readonly decisionId: string;
  readonly taskId: string;
  readonly trajectoryId: string;
  readonly question: string;
  readonly turnIndex: number;
  readonly plans: readonly TrajectoryPlan[];
  readonly exhausted?: { readonly reason: string; readonly ask: string; readonly at: string };
  readonly exploration?: Exploration;
  readonly snapshot?: string;
  readonly createdAt: string;
}

export interface TrajectoryChoice {
  readonly decisionId: string;
  readonly planId?: string;
  readonly text?: string;
  readonly turnIndex: number;
  readonly at: string;
}

export type TrajectoryStatus = 'current' | 'alternative' | 'abandoned';

export interface TrajectoryOrigin {
  readonly fromTrajectoryId: string;
  readonly turnIndex: number;
  readonly decisionId?: string;
  readonly planId?: string;
  readonly afterTaskId?: string;
}

export interface Trajectory {
  readonly trajectoryId: string;
  readonly label: string;
  readonly sessionId: string;
  readonly status: TrajectoryStatus;
  readonly taskIds: readonly string[];
  readonly choices: readonly TrajectoryChoice[];
  readonly turnCount: number;
  readonly origin?: TrajectoryOrigin;
  readonly workDir?: string;
  readonly abandonReason?: string;
  readonly createdAt: string;
}

export interface TaskReport {
  readonly summary: string;
  readonly deliverables: readonly TaskDeliverable[];
  readonly unresolved: readonly string[];
  readonly nextStep?: TaskNextStep;
  readonly reportedAt: string;
}

export interface TaskError {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly at: string;
}

export type ContinuoPermissionMode = 'manual' | 'yolo' | 'auto';

export interface TodoSchedule {
  readonly cron: string;
  readonly recurring: boolean;
  readonly label: string;
}

export interface ContinuoTodo {
  readonly todoId: string;
  readonly text: string;
  readonly title?: string;
  readonly reason?: string;
  readonly fromTaskId?: string;
  readonly schedule?: TodoSchedule;
  readonly nextAt?: string;
  readonly lastRunAt?: string;
  readonly createdAt: string;
}

export interface ContinuoTask {
  readonly taskId: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly name?: string;
  readonly category?: string;
  readonly trigger: TaskTrigger;
  readonly sessionId: string;
  readonly promptIds: readonly string[];
  readonly status: TaskStatus;
  readonly phase?: string;
  readonly pauseRequested: boolean;
  readonly contextRevision: number;
  readonly pendingInteraction?: 'question' | 'approval' | 'reply' | 'choice' | 'none';
  readonly lastReply?: string;
  readonly report?: TaskReport;
  readonly verification?: readonly string[];
  readonly supplements?: readonly string[];
  readonly sources?: readonly string[];
  readonly rounds?: readonly TaskRound[];
  readonly logPath?: string;
  readonly branch?: { readonly decisionId: string; readonly planId: string; readonly label: string };
  readonly snapshot?: string;
  readonly usage: TaskUsage;
  readonly lastError?: string;
  readonly error?: TaskError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
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
  readonly init: { readonly status: InitStatus; readonly taskId?: string; readonly startedAt?: string; readonly endedAt?: string };
  readonly scan?: WorkspaceScan;
  readonly understanding?: WorkspaceUnderstanding;
  readonly context: readonly ContextEntry[];
  readonly tasks: readonly ContinuoTask[];
  readonly trajectories: readonly Trajectory[];
  readonly decisions: readonly Decision[];
  readonly todos?: readonly ContinuoTodo[];
  readonly permissionMode?: ContinuoPermissionMode;
}

export function currentTaskOf(doc: ContinuoWorkspaceDoc, sessionId: string): ContinuoTask | undefined {
  const onSession = doc.tasks.filter((task) => task.sessionId === sessionId);
  return onSession.findLast((task) => task.endedAt === undefined) ?? onSession.at(-1);
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
    trajectories: [],
    decisions: [],
    todos: [],
  };
}
