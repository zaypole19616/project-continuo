export type Envelope<T> = { code: number; msg: string; data: T; request_id?: string };

const TOKEN_KEY = 'continuo.token';

export function readToken(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromHash = hash.get('token');
  if (fromHash) {
    try { localStorage.setItem(TOKEN_KEY, fromHash); } catch {}
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return fromHash;
  }
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}

export class ApiError extends Error {
  constructor(public readonly code: number | string, message: string) { super(message); }
}

const OFFLINE = '连不上本地服务，正在重试…';

export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'offline';
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readToken();
  const res = await fetch('/api/v1' + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new ApiError('offline', OFFLINE); });
  if (res.status === 401) throw new ApiError(401, '未授权：缺少或错误的服务 token');
  const env = (await res.json().catch(() => { throw new ApiError('offline', OFFLINE); })) as Envelope<T>;
  if (env.code !== 0) throw new ApiError(env.code, env.msg || `请求失败 (${env.code})`);
  return env.data;
}

export const api = {
  get: <T,>(path: string) => call<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
};

export interface Workspace { id: string; root: string; name: string; created_at: string; last_opened_at: string; session_count: number }
export interface Session { id: string; workspace_id?: string; title: string; busy: boolean; pending_interaction?: string; last_turn_reason?: string; agent_config?: { model?: string }; usage?: Record<string, number>; metadata?: { cwd?: string }; created_at: string; updated_at: string }
export interface Message { id: string; role: 'user' | 'assistant'; content: Array<{ type: string; text?: string }>; created_at: string; metadata?: { origin?: { kind?: string; variant?: string } } }
export interface QuestionOption { id: string; label: string; description?: string }
export interface QuestionItem { id: string; question: string; header?: string; body?: string; options: QuestionOption[]; multi_select?: boolean; allow_other?: boolean; other_label?: string }
export interface QuestionRequest { question_id: string; session_id: string; turn_id?: number; questions: QuestionItem[]; created_at: string }
export interface ApprovalRequest { approval_id: string; session_id: string; turn_id?: number; tool_call_id: string; tool_name: string; action: string; tool_input_display: unknown; created_at: string; expires_at: string }
export interface Snapshot { as_of_seq: number; session: Session; messages: { items: Message[]; has_more: boolean }; in_flight_turn: unknown; pending_approvals: ApprovalRequest[]; pending_questions: QuestionRequest[] }

export interface FsHome { home: string; recent_roots: string[] }
export interface FsBrowse { path: string; parent: string | null; entries: Array<{ name: string; path: string; is_dir: true }> }

export const DEFAULT_MODEL = 'kimi-code/kimi-for-coding';

export const kimi = {
  meta: () => api.get<{ server_version: string; backend: string }>('/meta'),
  planUsage: () => api.get<PlanUsage>('/oauth/usage'),
  workspaces: () => api.get<{ items: Workspace[] }>('/workspaces'),
  createWorkspace: (root: string, name?: string) => api.post<Workspace>('/workspaces', { root, name }),
  fsHome: () => api.get<FsHome>('/fs:home'),
  fsBrowse: (path?: string) => api.get<FsBrowse>('/fs:browse' + (path ? '?path=' + encodeURIComponent(path) : '')),
  fsMkdir: (path: string) => api.post<{ path: string }>('/fs:mkdir', { path }),
  sessions: (workspaceId: string) => api.get<{ items: Session[] }>('/sessions?workspace_id=' + encodeURIComponent(workspaceId)),
  createSession: (workspaceId: string, title?: string) => api.post<Session>('/sessions', { workspace_id: workspaceId, ...(title ? { title } : {}) }),
  setModel: (sessionId: string, model: string, permission_mode: 'manual' | 'yolo' | 'auto' = 'manual') =>
    api.post<Session>(`/sessions/${sessionId}/profile`, { agent_config: { model, permission_mode } }),
  snapshot: (sessionId: string) => api.get<Snapshot>(`/sessions/${sessionId}/snapshot`),
  submitPrompt: (sessionId: string, text: string) =>
    api.post<{ prompt_id: string; status: string }>(`/sessions/${sessionId}/prompts`, { content: [{ type: 'text', text }] }),
  abortPrompt: (sessionId: string, promptId: string) => api.post<unknown>(`/sessions/${sessionId}/prompts/${promptId}:abort`, {}),
  pendingQuestions: (sessionId: string) => api.get<{ items: QuestionRequest[] }>(`/sessions/${sessionId}/questions?status=pending`),
  resolveQuestion: (sessionId: string, questionId: string, answers: Record<string, unknown>, note?: string) =>
    api.post<unknown>(`/sessions/${sessionId}/questions/${questionId}`, { answers, method: 'click', ...(note ? { note } : {}) }),
  pendingApprovals: (sessionId: string) => api.get<{ items: ApprovalRequest[] }>(`/sessions/${sessionId}/approvals?status=pending`),
  resolveApproval: (sessionId: string, approvalId: string, decision: 'approved' | 'rejected', scope?: 'session') =>
    api.post<unknown>(`/sessions/${sessionId}/approvals/${approvalId}`, { decision, ...(scope ? { scope } : {}) }),
};

export interface TaskRound { at: string; prompt: string; reads: string[]; writes: string[]; reply: string; turnIndex?: number }
export interface TrajectoryPlan { planId: string; title: string; basis: string; risk: string; prompt: string; fit?: string; caution?: string; detail?: string; path: string; abandoned?: { reason?: string; at: string }; createdAt: string }
export interface ExplorationAngle { key: string; title: string; angle: string; status: 'queued' | 'running' | 'submitted' | 'withdrawn' | 'failed'; planId?: string; note?: string }
export interface Exploration { reason: string; angles: ExplorationAngle[]; maxSteps: number; startedAt: string; endedAt?: string }
export interface Decision { decisionId: string; taskId: string; trajectoryId: string; question: string; turnIndex: number; plans: TrajectoryPlan[]; exhausted?: { reason: string; ask: string; at: string }; exploration?: Exploration; stance?: { pick?: string; why?: string; dependsOn?: string; at: string }; createdAt: string }
export interface TrajectoryChoice { decisionId: string; planId?: string; text?: string; turnIndex: number; at: string }
export interface Trajectory { trajectoryId: string; label: string; sessionId: string; status: 'current' | 'alternative' | 'abandoned'; taskIds: string[]; choices: TrajectoryChoice[]; turnCount: number; origin?: { fromTrajectoryId: string; turnIndex: number; decisionId?: string; planId?: string; afterTaskId?: string }; abandonReason?: string; workDir?: string; createdAt: string }
export interface InitSuggestion { title: string; reason: string; prompt: string }
export interface TodoSchedule { cron: string; recurring: boolean; label: string }
export type TodoAction = 'start' | 'accept' | 'dismiss' | 'delete';
export interface ContinuoTodo { todoId: string; text: string; title?: string; reason?: string; fromTaskId?: string; state?: 'suggested' | 'started' | 'dismissed'; taskId?: string; schedule?: TodoSchedule; nextAt?: string; lastRunAt?: string; createdAt: string }
export type TodoTiming = { kind: 'once'; at: string } | { kind: 'daily'; time: string } | { kind: 'weekly'; day: number; time: string };
export type PermissionMode = 'manual' | 'yolo' | 'auto';
export interface TaskError { code: string; message: string; status?: number; requestId?: string; traceId?: string; at: string }
export type PlanUsage = { kind: 'ok'; quota: { usages: Record<string, { usedRatio: number; resetAt?: string }> } } | { kind: 'error'; message: string } | { kind: string };
export type TaskStatus = 'queued' | 'running' | 'awaiting_user' | 'verifying' | 'completed' | 'needs_review' | 'paused' | 'failed' | 'interrupted';
export interface ContinuoTask { taskId: string; kind: 'init' | 'user'; title: string; name?: string; category?: string; trigger: string; sessionId: string; promptIds: string[]; status: TaskStatus; phase?: string; pauseRequested: boolean; pendingInteraction?: 'question' | 'approval' | 'reply' | 'choice' | 'none'; lastReply?: string; report?: { summary: string; deliverables: Array<{ path: string; note?: string; exists?: boolean; turnId?: number }>; unresolved: string[]; nextStep?: { title: string; reason: string; prompt: string }; reportedAt: string }; verification?: string[]; supplements?: string[]; sources?: string[]; rounds?: TaskRound[]; logPath?: string; branch?: { decisionId: string; planId: string; label: string }; usage: { steps: number; inputTokens: number; cacheReadTokens: number; outputTokens: number }; error?: TaskError; createdAt: string; updatedAt: string; endedAt?: string }
export interface ContinuoDoc { workspaceId: string; root: string; revision: number; openCount: number; init: { status: 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped'; taskId?: string; startedAt?: string; endedAt?: string }; scan?: { counts: { dirs: number; files: number; byExt: Record<string, number> }; guideFiles: string[]; truncated: boolean; unscanned: string[] }; understanding?: { text: string; sourceRefs: string[]; suggestions?: InitSuggestion[]; updatedAt: string }; context: Array<{ id: string; text: string; sourceRefs: string[] }>; tasks: ContinuoTask[]; trajectories: Trajectory[]; decisions: Decision[]; todos?: ContinuoTodo[]; permissionMode?: PermissionMode }

export const continuo = {
  open: (workspaceId: string, clientRequestId: string) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo:open`, { client_request_id: clientRequestId }),
  get: (workspaceId: string) => api.get<ContinuoDoc>(`/workspaces/${workspaceId}/continuo`),
  createTask: (workspaceId: string, text: string, clientRequestId: string) => api.post<{ task: ContinuoTask; doc: ContinuoDoc }>(`/workspaces/${workspaceId}/continuo/tasks`, { text, client_request_id: clientRequestId }),
  taskAction: (workspaceId: string, taskId: string, action: 'pause' | 'resume' | 'reply' | 'fork', body: { text?: string } = {}) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/tasks/${taskId}:${action}`, body),
  decisionAction: (workspaceId: string, decisionId: string, action: 'choose' | 'expand' | 'abandon', body: { plan_id?: string; reason?: string } = {}) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/decisions/${decisionId}:${action}`, body),
  addTodo: (workspaceId: string, text: string, timing?: TodoTiming) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/todos`, { text, timing }),
  todoAction: (workspaceId: string, todoId: string, action: TodoAction) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/todos/${todoId}:${action}`, {}),
  retryInit: (workspaceId: string) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/init:retry`, {}),
  chooseFolder: (prompt: string, defaultPath?: string) => api.post<{ path: string | null }>('/continuo/choose-folder', { prompt, default_path: defaultPath }),
  setPermission: (workspaceId: string, mode: PermissionMode) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/permission`, { mode }),
  activateLine: (workspaceId: string, trajectoryId: string) => api.post<ContinuoDoc>(`/workspaces/${workspaceId}/continuo/trajectories/${trajectoryId}:activate`, {}),
};

export interface FileEntry { name: string; path: string; kind: 'file' | 'dir'; size: number; modifiedAt: string; producedBy?: string; isGuide: boolean; childCount?: number }
export interface FileListing { path: string; parent: string | null; entries: FileEntry[] }
export interface FileContent { path: string; size: number; modifiedAt: string; text?: string; truncated: boolean; binary: boolean; producedBy?: string }

export const continuoFiles = {
  list: (workspaceId: string, path = '') => api.get<FileListing>(`/workspaces/${workspaceId}/continuo/files?path=${encodeURIComponent(path)}`),
  read: (workspaceId: string, path: string) => api.get<FileContent>(`/workspaces/${workspaceId}/continuo/file?path=${encodeURIComponent(path)}`),
  before: (sessionId: string, turnId: number, path: string) => api.get<{ content: { version: number; content?: string; binary?: boolean } | null }>(`/sessions/${sessionId}/file-history/content?turn_id=${turnId}&path=${encodeURIComponent(path)}&phase=start`),
};

const RECENT_KEY = 'continuo.recent';
export function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function touchRecent(id: string): void {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}
export function forgetRecent(id: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((x) => x !== id))); } catch {}
}
