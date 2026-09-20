import { useCallback, useEffect, useRef, useState } from 'react';
import { continuo, kimi, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, type TimelineState } from '#/lib/timeline';
import { Timeline } from '#/components/Timeline';
import { ApprovalCard, QuestionCard } from '#/components/InteractionCards';
import { Board, type BoardAction } from '#/components/Board';
import { ContextPanel } from '#/components/ContextPanel';

type Tab = 'board' | 'context' | 'log';

const ACTIVE = new Set(['queued', 'running', 'awaiting_user', 'verifying']);
const isActive = (t: ContinuoTask) => ACTIVE.has(t.status);
const isAwaitingReply = (t: ContinuoTask) => t.status === 'awaiting_user' && t.pendingInteraction === 'reply';
const isBlocking = (t: ContinuoTask) => isActive(t) && !isAwaitingReply(t);
const newRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function pickDefaultTask(doc: ContinuoDoc): ContinuoTask | null {
  const users = doc.tasks.filter((t) => t.kind === 'user');
  const active = users.find(isActive);
  return active ?? users.at(-1) ?? doc.tasks.at(-1) ?? null;
}

export function WorkspaceView({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const [doc, setDoc] = useState<ContinuoDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('board');
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState('idle');
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [workLog, setWorkLog] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const streamRef = useRef<SessionStream | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const userPicked = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const d = await continuo.get(workspace.id);
      setDoc(d);
      return d;
    } catch (err) { setError((err as Error).message); return null; }
  }, [workspace.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await continuo.open(workspace.id, newRequestId());
        if (cancelled) return;
        setDoc(d);
      } catch (err) { if (!cancelled) setError((err as Error).message); }
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
    if (selectedId && doc.tasks.some((t) => t.taskId === selectedId) && userPicked.current) return;
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
    if (!sessionId) return;
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
      } catch (err) { if (!cancelled) setError((err as Error).message); }
    })();
    return () => { cancelled = true; streamRef.current?.close(); streamRef.current = null; };
  }, [sessionId, refreshPending, refresh]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [state.items.length, state.items.at(-1)?.kind === 'assistant' ? (state.items.at(-1) as { text: string }).text.length : 0]);

  useEffect(() => {
    if (tab !== 'log') return;
    let cancelled = false;
    void (async () => { try { const r = await continuo.workLog(workspace.id); if (!cancelled) setWorkLog(r.markdown); } catch (err) { if (!cancelled) setError((err as Error).message); } })();
    return () => { cancelled = true; };
  }, [tab, workspace.id, doc?.revision]);

  const activeUserTask = doc?.tasks.find((t) => t.kind === 'user' && isBlocking(t)) ?? null;
  const replyTarget = selected && selected.kind === 'user' && (isAwaitingReply(selected) || selected.status === 'completed' || selected.status === 'needs_review') ? selected : null;

  const send = async (mode: 'new' | 'reply' = 'new') => {
    const text = (taRef.current?.value ?? draft).trim();
    if (!text || sending) return;
    setSending(true); setError(null);
    try {
      if (mode === 'reply' && replyTarget) {
        const d = await continuo.taskAction(workspace.id, replyTarget.taskId, 'reply', { text });
        setDraft(''); if (taRef.current) taRef.current.value = '';
        setDoc(d); userPicked.current = false; setSelectedId(replyTarget.taskId);
      } else {
        const r = await continuo.createTask(workspace.id, text, newRequestId());
        setDraft(''); if (taRef.current) taRef.current.value = '';
        setDoc(r.doc); userPicked.current = false; setSelectedId(r.task.taskId); setTab('board');
      }
    } catch (err) { setError((err as Error).message); } finally { setSending(false); }
  };

  const action = async (task: ContinuoTask, a: BoardAction) => {
    setError(null);
    try { const d = await continuo.taskAction(workspace.id, task.taskId, a); setDoc(d); userPicked.current = false; setSelectedId(task.taskId); } catch (err) { setError((err as Error).message); }
  };

  const patchContext = async (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => {
    setError(null);
    try { const d = await continuo.patchContext(workspace.id, entry.id, { ...body, expected_revision: entry.revision }); setDoc(d); } catch (err) { setError((err as Error).message); throw err; }
  };

  const initTask = doc?.tasks.find((t) => t.kind === 'init');
  const headerStatus = !doc ? '打开中' : doc.init.status === 'running' ? '正在了解文件夹' : activeUserTask ? (activeUserTask.status === 'awaiting_user' ? '需要你' : 'Agent 工作中') : '空闲';
  const headerTag = headerStatus === '需要你' ? 'tag-wait' : headerStatus === '空闲' ? 'tag-done' : 'tag-run';

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <button className="btn text-xs" onClick={onClose}>← 换文件夹</button>
        <div className="font-medium">{workspace.name}</div>
        <div className="muted mono text-xs truncate flex-1">{workspace.root}</div>
        {doc && <div className="muted text-xs">第 {doc.openCount} 次打开 · 有效 context {doc.context.filter((e) => e.status === 'active').length} 条</div>}
        <span className={`tag ${headerTag}`}>{headerStatus}</span>
      </header>
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
        <main className="min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {error && <div className="panel p-3 text-sm" style={{ borderColor: 'var(--danger)' }}>{error}</div>}
            {doc && doc.init.status === 'running' && initTask && (
              <div className="panel p-3 text-sm space-y-1">
                <div className="font-medium">正在了解这个文件夹</div>
                {doc.scan && <div className="muted text-xs">{doc.scan.counts.dirs} 个文件夹、{doc.scan.counts.files} 个文件{doc.scan.guideFiles.length ? `，发现指引 ${doc.scan.guideFiles.join('、')}` : ''}</div>}
                {initTask.phase && <div className="muted text-xs">正在：{initTask.phase}</div>}
                <div className="muted text-xs">只读，不会改动任何文件。你可以先交代任务，会在了解完成后开始。</div>
              </div>
            )}
            {selected && (
              <div className="flex items-center gap-2 muted text-xs">
                <span>当前查看：{selected.kind === 'init' ? '了解这个工作空间' : selected.title}</span>
                {selected.kind === 'user' && selected.trigger === 'resume' && <span className="tag">续接</span>}
              </div>
            )}
            {!selected && doc && doc.init.status !== 'running' && (
              <div className="panel p-4 text-sm space-y-2">
                <div className="font-medium">这个文件夹是空的，还没有任务。</div>
                <div className="muted">交代第一个任务，Continuo 会在这里执行，并把过程和产物记录到工作空间里。</div>
              </div>
            )}
            <Timeline items={state.items} />
            {sessionId && questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={async (answers, note) => { await kimi.resolveQuestion(sessionId, q.question_id, answers, note); await refreshPending(sessionId); void refresh(); }} />)}
            {sessionId && approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} onDecide={async (d, scope) => { await kimi.resolveApproval(sessionId, a.approval_id, d, scope); await refreshPending(sessionId); void refresh(); }} />)}
            <div ref={bottomRef} />
          </div>
          <div className="p-3 border-t" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            {activeUserTask ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="muted flex-1">{activeUserTask.status === 'awaiting_user' ? (activeUserTask.pendingInteraction === 'approval' ? '任务在等你批准上面的操作。' : '任务在等你回答上面的问题。') : `正在执行「${activeUserTask.title}」，同一时间只跑一个任务。`}</span>
                <button className="btn" onClick={() => { void action(activeUserTask, 'pause'); }}>停止</button>
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <textarea ref={taRef} className="flex-1 resize-none" rows={2} placeholder={replyTarget && isAwaitingReply(replyTarget) ? '回复这个任务；Enter 回复，Shift+Enter 换行' : '交代一个任务，Enter 发送，Shift+Enter 换行'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(replyTarget && isAwaitingReply(replyTarget) ? 'reply' : 'new'); } }} />
                {replyTarget && <button className={`btn ${isAwaitingReply(replyTarget) ? 'btn-primary' : ''}`} disabled={!doc || sending} onClick={() => { void send('reply'); }}>{isAwaitingReply(replyTarget) ? '回复' : '追问这个任务'}</button>}
                <button className={`btn ${replyTarget && isAwaitingReply(replyTarget) ? '' : 'btn-primary'}`} disabled={!doc || sending} onClick={() => { void send('new'); }}>新任务</button>
              </div>
            )}
          </div>
        </main>
        <aside className="min-h-0 flex flex-col border-l" style={{ borderColor: 'var(--line)' }}>
          <div className="flex gap-1 p-2 border-b" style={{ borderColor: 'var(--line)' }}>
            {(['board', 'context', 'log'] as Tab[]).map((t) => (
              <button key={t} className={`btn text-xs ${tab === t ? 'btn-primary' : ''}`} onClick={() => setTab(t)}>{t === 'board' ? '看板' : t === 'context' ? 'Context' : '工作日志'}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {!doc && <div className="muted text-sm">打开中…</div>}
            {doc && tab === 'board' && <Board doc={doc} selectedTaskId={selectedId} connection={connection} onSelect={(t) => { userPicked.current = true; setSelectedId(t.taskId); }} onAction={(t, a) => { void action(t, a); }} />}
            {doc && tab === 'context' && <ContextPanel doc={doc} onPatch={patchContext} />}
            {doc && tab === 'log' && <pre className="text-xs whitespace-pre-wrap mono">{workLog || '加载中…'}</pre>}
          </div>
        </aside>
      </div>
    </div>
  );
}
