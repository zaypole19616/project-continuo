import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { continuo, kimi, type ApprovalRequest, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, withUserMessage, type TimelineState } from '#/lib/timeline';
import { resolveTheme, type ThemePref } from '#/lib/theme';
import type { NavTarget } from '#/components/FileBrowser';
import { Finder } from '#/components/Finder';
import { Drawer } from '#/components/Drawer';
import { Button } from '#/components/ui/button';

const ACTIVE = new Set(['queued', 'running', 'awaiting_user', 'verifying']);
const isActive = (t: ContinuoTask) => ACTIVE.has(t.status);
const isAwaitingReply = (t: ContinuoTask) => t.status === 'awaiting_user' && t.pendingInteraction === 'reply';
const isBlocking = (t: ContinuoTask) => isActive(t) && !isAwaitingReply(t);
const newRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function WorkspaceView({ workspace, onClose, themePref, onTheme }: { workspace: Workspace; onClose: () => void; themePref: ThemePref; onTheme: (pref: ThemePref) => void }) {
  const workspaceId = workspace.id;
  const [doc, setDoc] = useState<ContinuoDoc | null>(null);
  const [target, setTarget] = useState<NavTarget>({ kind: 'folder', path: '' });
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [sending, setSending] = useState(false);
  const streamRef = useRef<SessionStream | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pendingUser = useRef<{ sessionId: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try { const d = await continuo.get(workspaceId); setDoc(d); return d; } catch (error) { setError((error as Error).message); return null; }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setTarget({ kind: 'folder', path: '' }); setError(null);
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

  const latest = doc?.tasks.findLast((t) => t.kind === 'user' && t.sessionId !== '') ?? null;
  const sessionId = latest?.sessionId ?? null;

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeUserTask = doc?.tasks.find((t) => t.kind === 'user' && isBlocking(t)) ?? null;
  const replyTarget = latest !== null && isAwaitingReply(latest) ? latest : null;

  const submit = async (text: string, reply: ContinuoTask | null) => {
    setSending(true); setError(null);
    try {
      if (sessionId !== null) setState((prev) => withUserMessage(prev, `local_${Date.now()}`, text));
      if (reply !== null) {
        setDoc(await continuo.taskAction(workspaceId, reply.taskId, 'reply', { text }));
      } else {
        const r = await continuo.createTask(workspaceId, text, newRequestId());
        if (sessionId === null) pendingUser.current = { sessionId: r.task.sessionId, text };
        setDoc(r.doc);
      }
      if (composerRef.current) composerRef.current.value = '';
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };

  const send = () => {
    const text = (composerRef.current?.value ?? '').trim();
    if (!text || sending) return;
    void submit(text, replyTarget);
  };

  const action = async (task: ContinuoTask, a: 'pause' | 'resume' | 'complete') => {
    setError(null);
    try { setDoc(await continuo.taskAction(workspaceId, task.taskId, a)); } catch (error) { setError((error as Error).message); }
  };

  const dark = resolveTheme(themePref) === 'dark';

  return (
    <div className="project">
      <div className="project-top chrome">
        <Button variant="ghost" size="sm" onClick={onClose} title="回到项目列表"><ChevronLeft size={15} />项目</Button>
        <span className="sep">/</span>
        <span className="project-name">{workspace.name}</span>
        <span className="project-path" title={workspace.root}>{workspace.root}</span>
        <span className="flex-1" />
        <button className="icon-btn" title={dark ? '切换到浅色' : '切换到深色'} onClick={() => onTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      </div>
      <div className="project-body">
        <Finder workspaceId={workspaceId} root={workspace.root} doc={doc} target={target} onNavigate={setTarget} onError={setError} searchRef={searchRef} />
        <Drawer
          workspace={workspace} doc={doc} latest={latest} state={state} questions={questions} approvals={approvals} error={error}
          activeUserTask={activeUserTask} replyTarget={replyTarget} composerRef={composerRef} sending={sending}
          onSend={send}
          onAnswer={async (q, answers, note) => { if (!sessionId) return; await kimi.resolveQuestion(sessionId, q.question_id, answers, note); await refreshPending(sessionId); void refresh(); }}
          onDecide={async (a, d, scope) => { if (!sessionId) return; await kimi.resolveApproval(sessionId, a.approval_id, d, scope); await refreshPending(sessionId); void refresh(); }}
          onAction={(t, a) => { void action(t, a); }} onOpenFile={(path) => setTarget({ kind: 'file', path })}
          onStartStep={(text) => { if (!sending) void submit(text, null); }} onError={setError}
        />
      </div>
    </div>
  );
}
