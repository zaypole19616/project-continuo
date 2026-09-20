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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readToken();
  const res = await fetch('/api/v1' + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new ApiError(401, '未授权：缺少或错误的服务 token');
  const env = (await res.json()) as Envelope<T>;
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
