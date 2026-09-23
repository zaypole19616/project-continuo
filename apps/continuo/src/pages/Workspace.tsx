import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { continuo, isOffline, kimi, type ApprovalRequest, type ContinuoDoc, type ContinuoTask, type Decision, type QuestionRequest, type Trajectory, type TrajectoryPlan, type Workspace } from '#/lib/api';
import { currentLine, tasksOn } from '#/lib/trajectory';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, withUserMessage, type TimelineState } from '#/lib/timeline';
import { resolveTheme, type ThemePref } from '#/lib/theme';
import type { NavTarget } from '#/components/FileBrowser';
import { Finder } from '#/components/Finder';
import { Drawer } from '#/components/Drawer';
import { Button } from '#/components/ui/button';

const ACTIVE = new Set(['queued', 'running', 'awaiting_user', 'verifying']);
const isActive = (t: ContinuoTask) => ACTIVE.has(t.status);
const isAwaitingReply = (t: ContinuoTask) => t.status === 'awaiting_user' && (t.pendingInteraction === 'reply' || t.pendingInteraction === 'choice');
const isBlocking = (t: ContinuoTask) => isActive(t) && !isAwaitingReply(t);
const DRAWER_KEY = 'continuo.drawer';
const DRAWER_DEFAULT = 400;

function readDrawerWidth(): number {
  try {
    const stored = Number(localStorage.getItem(DRAWER_KEY));
    return stored >= 320 && stored <= 760 ? stored : DRAWER_DEFAULT;
  } catch {
    return DRAWER_DEFAULT;
  }
}

const newRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function WorkspaceView({ workspace, onClose, themePref, onTheme }: { workspace: Workspace; onClose: () => void; themePref: ThemePref; onTheme: (pref: ThemePref) => void }) {
  const workspaceId = workspace.id;
  const [doc, setDoc] = useState<ContinuoDoc | null>(null);
  const [target, setTarget] = useState<NavTarget>({ kind: 'folder', path: '' });
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [sending, setSending] = useState(false);
  const streamRef = useRef<SessionStream | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pendingUser = useRef<{ sessionId: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(readDrawerWidth);

  const refresh = useCallback(async () => {
    try { const d = await continuo.get(workspaceId); setDoc(d); setOffline(false); return d; } catch (error) { if (isOffline(error)) setOffline(true); else setError((error as Error).message); return null; }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setTarget({ kind: 'folder', path: '' }); setError(null);
    void (async () => {
      try { const d = await continuo.open(workspaceId, newRequestId()); if (!cancelled) setDoc(d); } catch (error) { if (!cancelled) { if (isOffline(error)) setOffline(true); else setError((error as Error).message); } }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!doc && !offline) return;
    const anyActive = offline || doc === null || doc.tasks.some(isActive) || doc.init.status === 'running';
    const timer = window.setInterval(() => { void refresh(); }, anyActive ? 1500 : 6000);
    return () => window.clearInterval(timer);
  }, [doc, offline, refresh]);

  const line = doc === null ? undefined : currentLine(doc);
  const lineTasks = doc === null ? [] : tasksOn(doc, line);
  const latest = lineTasks.at(-1) ?? null;
  const sessionId = line?.sessionId ?? null;
  const lineId = line?.trajectoryId;

  useEffect(() => { setTarget({ kind: 'folder', path: '' }); }, [lineId]);

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
          if (ev.type === 'turn.ended') {
            void refresh();
            void kimi.snapshot(sessionId).then((fresh) => {
              if (cancelled) return;
              setState((prev) => ({ ...fromMessages(prev, fresh.messages.items), busy: fresh.session.busy, pendingInteraction: fresh.session.pending_interaction ?? 'none' }));
            }).catch(() => undefined);
          }
        });
      } catch (error) { if (!cancelled) { if (isOffline(error)) setOffline(true); else setError((error as Error).message); } }
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

  const activeUserTask = lineTasks.find(isBlocking) ?? null;
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

  const action = async (task: ContinuoTask, a: 'pause' | 'resume') => {
    setError(null);
    try { setDoc(await continuo.taskAction(workspaceId, task.taskId, a)); } catch (error) { setError((error as Error).message); }
  };

  const run = async (work: () => Promise<ContinuoDoc>): Promise<boolean> => {
    setSending(true); setError(null);
    try { setDoc(await work()); return true; } catch (error) { setError((error as Error).message); return false; } finally { setSending(false); }
  };
  const choose = (decision: Decision, plan: TrajectoryPlan) => run(() => continuo.decisionAction(workspaceId, decision.decisionId, 'choose', { plan_id: plan.planId }));
  const expand = (decision: Decision) => run(() => continuo.decisionAction(workspaceId, decision.decisionId, 'expand'));
  const abandon = (decision: Decision, plan: TrajectoryPlan, reason: string) => { void run(() => continuo.decisionAction(workspaceId, decision.decisionId, 'abandon', { plan_id: plan.planId, reason: reason.trim() === '' ? undefined : reason.trim() })); };
  const switchLine = (target: Trajectory) => { void run(() => continuo.activateLine(workspaceId, target.trajectoryId)); };
  const forkAfter = (task: ContinuoTask) => run(() => continuo.taskAction(workspaceId, task.taskId, 'fork'));
  const retryInit = () => { void run(() => continuo.open(workspaceId, newRequestId())); };

  const dark = resolveTheme(themePref) === 'dark';
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDrawerWidth(Math.min(760, Math.max(320, window.innerWidth - e.clientX)));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    try { localStorage.setItem(DRAWER_KEY, String(drawerWidth)); } catch {}
  };

  return (
    <div className="project">
      <div className="project-top chrome">
        <Button variant="ghost" size="sm" onClick={onClose} title="回到项目列表"><ChevronLeft size={15} />项目</Button>
        <span className="sep">/</span>
        <span className="project-name">{workspace.name}</span>
        {line?.origin !== undefined && <span className="line-chip" title={line.workDir === undefined ? '这条轨迹和原来的轨迹共用项目文件夹' : `这条轨迹的文件在 ${line.workDir}`}>{line.label}</span>}
        <span className="project-path" title={workspace.root}>{workspace.root}</span>
        <span className="flex-1" />
        <button className="icon-btn" title={dark ? '切换到浅色' : '切换到深色'} onClick={() => onTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      </div>
      <div className="project-body" style={{ '--drawer-w': `${drawerWidth}px` } as React.CSSProperties}>
        <Finder workspaceId={workspaceId} root={workspace.root} doc={doc} target={target} onNavigate={setTarget} onError={setError} searchRef={searchRef} />
        <div
          className={`drawer-resizer ${dragging ? 'is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话框宽度"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => setDragging(false)}
          onDoubleClick={() => setDrawerWidth(DRAWER_DEFAULT)}
        />
        <Drawer
          workspace={workspace} doc={doc} line={line} latest={latest} state={state} questions={questions} approvals={approvals} error={error ?? (offline ? '连不上本地服务，正在重试…' : null)}
          activeUserTask={activeUserTask} replyTarget={replyTarget} composerRef={composerRef} sending={sending}
          onSend={send}
          onAnswer={async (q, answers, note) => { if (!sessionId) return; await kimi.resolveQuestion(sessionId, q.question_id, answers, note); await refreshPending(sessionId); void refresh(); }}
          onDecide={async (a, d, scope) => { if (!sessionId) return; await kimi.resolveApproval(sessionId, a.approval_id, d, scope); await refreshPending(sessionId); void refresh(); }}
          onAction={(t, a) => { void action(t, a); }} onOpenFile={(path) => setTarget({ kind: 'file', path })}
          onStartStep={(text) => { if (!sending) void submit(text, null); }}
          onChoose={choose} onExpand={expand} onAbandon={abandon} onSwitch={switchLine} onForkAfter={forkAfter} onRetryInit={retryInit}
        />
      </div>
    </div>
  );
}
