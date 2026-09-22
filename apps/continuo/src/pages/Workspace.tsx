import { useCallback, useEffect, useRef, useState } from 'react';
import { continuo, kimi, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, withUserMessage, type TimelineState } from '#/lib/timeline';
import type { ThemePref } from '#/lib/theme';
import type { NavTarget } from '#/components/FileBrowser';
import { Finder } from '#/components/Finder';
import { Drawer } from '#/components/Drawer';
import { Button } from '#/components/ui/button';

const ACTIVE = new Set(['queued', 'running', 'awaiting_user', 'verifying']);
const isActive = (t: ContinuoTask) => ACTIVE.has(t.status);
const isAwaitingReply = (t: ContinuoTask) => t.status === 'awaiting_user' && t.pendingInteraction === 'reply';
const isBlocking = (t: ContinuoTask) => isActive(t) && !isAwaitingReply(t);
const newRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function pickDefaultTask(doc: ContinuoDoc): ContinuoTask | null {
  return doc.tasks.filter((t) => t.kind === 'user').findLast(isActive) ?? null;
}

export function WorkspaceView({ workspace, onClose, themePref, onTheme }: { workspace: Workspace; onClose: () => void; themePref: ThemePref; onTheme: (pref: ThemePref) => void }) {
  const workspaceId = workspace.id;
  const [doc, setDoc] = useState<ContinuoDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<NavTarget>({ kind: 'folder', path: '' });
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [sending, setSending] = useState(false);
  const streamRef = useRef<SessionStream | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const userPicked = useRef(false);
  const pendingUser = useRef<{ sessionId: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try { const d = await continuo.get(workspaceId); setDoc(d); return d; } catch (error) { setError((error as Error).message); return null; }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setSelectedId(null); userPicked.current = false; setTarget({ kind: 'folder', path: '' }); setError(null);
    void (async () => {
      try { const d = await continuo.open(workspaceId, newRequestId()); if (!cancelled) setDoc(d); } catch (error) { if (!cancelled) setError((error as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

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
    if (!sessionId) { setState(emptyTimeline()); setQuestions([]); setApprovals([]); return; }
    let cancelled = false;
    setState(emptyTimeline()); setQuestions([]); setApprovals([]);
    void (async () => {
      try {
        const snap = await kimi.snapshot(sessionId);
        if (cancelled) return;
        setState((prev) => {
          const next: TimelineState = { ...fromMessages(prev, snap.messages.items), busy: snap.session.busy, pendingInteraction: snap.session.pending_interaction ?? 'none' };
          const pending = pendingUser.current;
          return pending !== null && pending.sessionId === sessionId ? withUserMessage(next, `local_${sessionId}`, pending.text) : next;
        });
        setQuestions(snap.pending_questions); setApprovals(snap.pending_approvals);
        const stream = new SessionStream(sessionId);
        streamRef.current = stream;
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
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newSession(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const activeUserTask = doc?.tasks.find((t) => t.kind === 'user' && isBlocking(t)) ?? null;
  const continueTarget = selected && selected.kind === 'user' && selected.sessionId !== '' && !isBlocking(selected) ? selected : null;
  const sessions = doc ? doc.tasks.filter((t) => t.kind === 'user').toReversed() : [];

  const send = async () => {
    const text = (composerRef.current?.value ?? '').trim();
    if (!text || sending) return;
    setSending(true); setError(null);
    try {
      if (continueTarget) {
        const d = await continuo.taskAction(workspaceId, continueTarget.taskId, 'reply', { text });
        if (composerRef.current) composerRef.current.value = '';
        setDoc(d); userPicked.current = true; setSelectedId(continueTarget.taskId);
      } else {
        const r = await continuo.createTask(workspaceId, text, newRequestId());
        if (composerRef.current) composerRef.current.value = '';
        setDoc(r.doc); userPicked.current = true; setSelectedId(r.task.taskId);
        pendingUser.current = { sessionId: r.task.sessionId, text };
      }
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };

  const startStep = async (text: string) => {
    if (sending) return;
    setSending(true); setError(null);
    try { const r = await continuo.createTask(workspaceId, text, newRequestId()); setDoc(r.doc); userPicked.current = true; setSelectedId(r.task.taskId); pendingUser.current = { sessionId: r.task.sessionId, text }; } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };

  const action = async (task: ContinuoTask, a: 'pause' | 'resume' | 'complete') => {
    setError(null);
    try { const d = await continuo.taskAction(workspaceId, task.taskId, a); setDoc(d); userPicked.current = true; setSelectedId(task.taskId); } catch (error) { setError((error as Error).message); }
  };

  const reunderstand = async () => {
    setError(null);
    try { setDoc(await continuo.reunderstand(workspaceId)); } catch (error) { setError((error as Error).message); }
  };

  const patchContext = async (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => {
    setError(null);
    try { const d = await continuo.patchContext(workspaceId, entry.id, { ...body, expected_revision: entry.revision }); setDoc(d); } catch (error) { setError((error as Error).message); throw error; }
  };

  const selectTask = (task: ContinuoTask) => { userPicked.current = true; setSelectedId(task.taskId); };
  const newSession = () => { userPicked.current = true; setSelectedId(null); setTimeout(() => composerRef.current?.focus(), 50); };
  const openFile = (path: string) => { setTarget({ kind: 'file', path }); };

  return (
    <div className="project">
      <div className="project-top chrome">
        <span className="brand"><span className="brand-mark" />Continuo</span>
        <span className="sep">›</span>
        <span className="project-name">{workspace.name}</span>
        <span className="project-path" title={workspace.root}>{workspace.root}</span>
        <span className="flex-1" />
        <select className="theme-select" value={themePref} onChange={(e) => onTheme(e.target.value as ThemePref)} aria-label="外观">
          <option value="dark">深色</option>
          <option value="light">浅色</option>
          <option value="system">跟随系统</option>
        </select>
        <Button variant="ghost" size="sm" onClick={onClose}>项目列表</Button>
      </div>
      <div className="project-body">
        <Finder workspaceId={workspaceId} root={workspace.root} doc={doc} target={target} onNavigate={setTarget} onSelectTask={selectTask} onError={setError} searchRef={searchRef} />
        <Drawer
          workspace={workspace} doc={doc} selected={selected} sessions={sessions}
          state={state} questions={questions} approvals={approvals} error={error}
          activeUserTask={activeUserTask} continueTarget={continueTarget} composerRef={composerRef} sending={sending}
          onSend={() => { void send(); }}
          onAnswer={async (q, answers, note) => { if (!sessionId) return; await kimi.resolveQuestion(sessionId, q.question_id, answers, note); await refreshPending(sessionId); void refresh(); }}
          onDecide={async (a, d, scope) => { if (!sessionId) return; await kimi.resolveApproval(sessionId, a.approval_id, d, scope); await refreshPending(sessionId); void refresh(); }}
          onAction={(t, a) => { void action(t, a); }} onOpenFile={openFile} onPatchContext={patchContext} onReunderstand={() => { void reunderstand(); }}
          onStartStep={(text) => { void startStep(text); }} onSelectTask={selectTask} onNewSession={newSession} onError={setError}
        />
      </div>
    </div>
  );
}
