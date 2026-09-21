import { useCallback, useEffect, useRef, useState } from 'react';
import { continuo, kimi, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, type TimelineState } from '#/lib/timeline';
import { Sidebar } from '#/components/Sidebar';
import type { NavTarget } from '#/components/FileBrowser';
import { AgentPanel } from '#/components/AgentPanel';
import { SidePanel, type SideMode } from '#/components/SidePanel';
import type { BoardAction } from '#/components/Board';

const ACTIVE = new Set(['queued', 'running', 'awaiting_user', 'verifying']);
const isActive = (t: ContinuoTask) => ACTIVE.has(t.status);
const isAwaitingReply = (t: ContinuoTask) => t.status === 'awaiting_user' && t.pendingInteraction === 'reply';
const isBlocking = (t: ContinuoTask) => isActive(t) && !isAwaitingReply(t);
const newRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function pickDefaultTask(doc: ContinuoDoc): ContinuoTask | null {
  const users = doc.tasks.filter((t) => t.kind === 'user');
  return users.find(isActive) ?? users.at(-1) ?? doc.tasks.at(-1) ?? null;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const readPref = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; } };
const writePref = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch {} };

export function WorkspaceView({ workspace, onSwitch, onClose, onAbout }: { workspace: Workspace; onSwitch: (w: Workspace) => void; onClose: () => void; onAbout: (bet?: string) => void }) {
  const [doc, setDoc] = useState<ContinuoDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sideMode, setSideMode] = useState<SideMode | null>(() => { try { const v = localStorage.getItem('continuo.side'); return v === 'none' ? null : ((v as SideMode | null) ?? 'files'); } catch { return 'files'; } });
  const [navCollapsed, setNavCollapsed] = useState(() => readPref('continuo.nav.collapsed', false));
  const narrow = useMediaQuery('(max-width: 1000px) and (min-width: 761px)');
  const [target, setTarget] = useState<NavTarget>({ kind: 'folder', path: '' });
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState('idle');
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [workLog, setWorkLog] = useState('');
  const [sending, setSending] = useState(false);
  const streamRef = useRef<SessionStream | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const userPicked = useRef(false);

  const refresh = useCallback(async () => {
    try { const d = await continuo.get(workspace.id); setDoc(d); return d; } catch (error) { setError((error as Error).message); return null; }
  }, [workspace.id]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setSelectedId(null); userPicked.current = false; setTarget({ kind: 'folder', path: '' }); setError(null);
    void (async () => {
      try { const d = await continuo.open(workspace.id, newRequestId()); if (!cancelled) setDoc(d); } catch (error) { if (!cancelled) setError((error as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [workspace.id]);

  useEffect(() => {
    if (!doc) return;
    const anyActive = doc.tasks.some(isActive) || doc.init.status === 'running';
    const timer = window.setInterval(() => { void refresh(); }, anyActive ? 1500 : 6000);
    return () => window.clearInterval(timer);
  }, [doc, refresh]);

  useEffect(() => {
    if (!doc) return;
    if (userPicked.current && (selectedId === null || doc.tasks.some((t) => t.taskId === selectedId))) return;
    const pick = pickDefaultTask(doc);
    if (pick && pick.taskId !== selectedId) setSelectedId(pick.taskId);
  }, [doc, selectedId]);

  const selected = doc?.tasks.find((t) => t.taskId === selectedId) ?? null;
  const sessionId = selected?.sessionId ?? null;

  const refreshPending = useCallback(async (sid: string) => {
    const [q, a] = await Promise.all([kimi.pendingQuestions(sid), kimi.pendingApprovals(sid)]);
    setQuestions(q.items); setApprovals(a.items);
  }, []);

  useEffect(() => {
    if (!sessionId) { setState(emptyTimeline()); setQuestions([]); setApprovals([]); setConnection('idle'); return; }
    let cancelled = false;
    setState(emptyTimeline()); setQuestions([]); setApprovals([]); setConnection('connecting');
    void (async () => {
      try {
        const snap = await kimi.snapshot(sessionId);
        if (cancelled) return;
        setState((prev) => ({ ...fromMessages(prev, snap.messages.items), busy: snap.session.busy, pendingInteraction: snap.session.pending_interaction ?? 'none' }));
        setQuestions(snap.pending_questions); setApprovals(snap.pending_approvals);
        const stream = new SessionStream(sessionId);
        streamRef.current = stream;
        stream.onStatus = setConnection;
        stream.subscribe((ev) => {
          setState((prev) => applyEvent(prev, ev));
          if (ev.type === 'event.session.work_changed') { void refreshPending(sessionId); void refresh(); }
          if (ev.type === 'turn.ended') void refresh();
        });
      } catch (error) { if (!cancelled) setError((error as Error).message); }
    })();
    return () => { cancelled = true; streamRef.current?.close(); streamRef.current = null; };
  }, [sessionId, refreshPending, refresh]);

  useEffect(() => {
    if (sideMode !== 'log') return;
    let cancelled = false;
    void (async () => { try { const r = await continuo.workLog(workspace.id); if (!cancelled) setWorkLog(r.markdown); } catch (error) { if (!cancelled) setError((error as Error).message); } })();
    return () => { cancelled = true; };
  }, [sideMode, workspace.id, doc?.revision]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); focusComposer(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const activeUserTask = doc?.tasks.find((t) => t.kind === 'user' && isBlocking(t)) ?? null;
  const replyTarget = selected && selected.kind === 'user' && (isAwaitingReply(selected) || selected.status === 'completed' || selected.status === 'needs_review') ? selected : null;

  const send = async (mode: 'new' | 'reply') => {
    const text = (composerRef.current?.value ?? '').trim();
    if (!text || sending) return;
    setSending(true); setError(null);
    try {
      if (mode === 'reply' && replyTarget) {
        const d = await continuo.taskAction(workspace.id, replyTarget.taskId, 'reply', { text });
        if (composerRef.current) composerRef.current.value = '';
        setDoc(d); userPicked.current = false; setSelectedId(replyTarget.taskId);
      } else {
        const r = await continuo.createTask(workspace.id, text, newRequestId());
        if (composerRef.current) composerRef.current.value = '';
        setDoc(r.doc); userPicked.current = false; setSelectedId(r.task.taskId);
      }
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };

  const action = async (task: ContinuoTask, a: BoardAction) => {
    setError(null);
    try { const d = await continuo.taskAction(workspace.id, task.taskId, a); setDoc(d); userPicked.current = false; setSelectedId(task.taskId); } catch (error) { setError((error as Error).message); }
  };

  const patchContext = async (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => {
    setError(null);
    try { const d = await continuo.patchContext(workspace.id, entry.id, { ...body, expected_revision: entry.revision }); setDoc(d); } catch (error) { setError((error as Error).message); throw error; }
  };

  const setSide = (m: SideMode | null) => { setSideMode(m); try { localStorage.setItem('continuo.side', m ?? 'none'); } catch {} };
  const selectTask = (task: ContinuoTask) => { userPicked.current = true; setSelectedId(task.taskId); };
  const openFile = (path: string) => { setTarget({ kind: 'file', path }); setSide('files'); };
  const toggleNav = () => setNavCollapsed((v) => { writePref('continuo.nav.collapsed', !v); return !v; });
  const focusComposer = () => { userPicked.current = true; setSelectedId(null); setTimeout(() => composerRef.current?.focus(), 50); };
  const focusSearch = () => { setSide('files'); setTimeout(() => searchRef.current?.focus(), 50); };

  return (
    <div className={`shell ${navCollapsed ? 'nav-collapsed' : ''} ${sideMode === null ? 'side-collapsed' : ''}`}>
      <Sidebar workspace={workspace} doc={doc} collapsed={navCollapsed || narrow} selectedTaskId={selectedId} onToggle={toggleNav} onSelectTask={selectTask} onSwitchWorkspace={onSwitch} onAddWorkspace={onClose} onNewTask={focusComposer} onSearch={focusSearch} onAbout={() => onAbout()} />
      <AgentPanel
        workspaceName={workspace.name} doc={doc} sideMode={sideMode} onSide={setSide}
        selected={selected} state={state} questions={questions} approvals={approvals} connection={connection} error={error}
        activeUserTask={activeUserTask} replyTarget={replyTarget} composerRef={composerRef} sending={sending}
        onSend={(mode) => { void send(mode); }}
        onAnswer={async (q, answers, note) => { if (!sessionId) return; await kimi.resolveQuestion(sessionId, q.question_id, answers, note); await refreshPending(sessionId); void refresh(); }}
        onDecide={async (a, d, scope) => { if (!sessionId) return; await kimi.resolveApproval(sessionId, a.approval_id, d, scope); await refreshPending(sessionId); void refresh(); }}
        onAction={(t, a) => { void action(t, a); }} onOpenFile={openFile} onAbout={(bet) => onAbout(bet)} onPatchContext={patchContext}
      />
      {sideMode !== null && (
        <SidePanel mode={sideMode} onMode={setSide} onClose={() => setSide(null)} workspaceId={workspace.id} root={workspace.root} doc={doc} target={target} onNavigate={setTarget} onSelectTask={selectTask} selectedTaskId={selectedId} workLog={workLog} onAction={(t, a) => { void action(t, a); }} onPatchContext={patchContext} onError={setError} searchRef={searchRef} />
      )}
    </div>
  );
}
