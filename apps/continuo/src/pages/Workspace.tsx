import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MODEL, kimi, type ApprovalRequest, type QuestionRequest, type Session, type Workspace } from '#/lib/api';
import { SessionStream } from '#/lib/ws';
import { applyEvent, emptyTimeline, fromMessages, type TimelineState } from '#/lib/timeline';
import { Timeline } from '#/components/Timeline';
import { ApprovalCard, QuestionCard } from '#/components/InteractionCards';
import { Board, type BoardTask } from '#/components/Board';

export function WorkspaceView({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<TimelineState>(emptyTimeline());
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [connection, setConnection] = useState('connecting');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const streamRef = useRef<SessionStream | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshPending = useCallback(async (sid: string) => {
    const [q, a] = await Promise.all([kimi.pendingQuestions(sid), kimi.pendingApprovals(sid)]);
    setQuestions(q.items); setApprovals(a.items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await kimi.sessions(workspace.id);
        let s = existing.items.filter((x) => !('archived' in x && (x as { archived?: boolean }).archived)).toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (!s) s = await kimi.createSession(workspace.id);
        if (!s.agent_config?.model) s = await kimi.setModel(s.id, DEFAULT_MODEL);
        if (cancelled) return;
        setSession(s);
        const snap = await kimi.snapshot(s.id);
        if (cancelled) return;
        setState((prev) => ({ ...fromMessages(prev, snap.messages.items), busy: snap.session.busy, pendingInteraction: snap.session.pending_interaction ?? 'none' }));
        setQuestions(snap.pending_questions); setApprovals(snap.pending_approvals);
        const stream = new SessionStream(s.id);
        streamRef.current = stream;
        stream.onStatus = setConnection;
        stream.subscribe((ev) => {
          setState((prev) => applyEvent(prev, ev));
          if (ev.type === 'prompt.submitted') setActivePrompt(typeof ev.payload['promptId'] === 'string' ? ev.payload['promptId'] : null);
          if (ev.type === 'prompt.completed' || ev.type === 'prompt.aborted') setActivePrompt(null);
          if (ev.type === 'event.session.work_changed') void refreshPending(s.id);
        });
      } catch (error) { if (!cancelled) setError((error as Error).message); }
    })();
    return () => { cancelled = true; streamRef.current?.close(); };
  }, [workspace.id, refreshPending]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [state.items.length, state.items.at(-1)?.kind === 'assistant' ? (state.items.at(-1) as { text: string }).text.length : 0]);

  const send = async () => {
    const text = (taRef.current?.value ?? draft).trim();
    if (!session || !text) return;
    setDraft(''); if (taRef.current) taRef.current.value = ''; setError(null);
    try { const r = await kimi.submitPrompt(session.id, text); setActivePrompt(r.prompt_id); } catch (error) { setError((error as Error).message); }
  };

  const stop = async () => {
    if (!session || !activePrompt) return;
    try { await kimi.abortPrompt(session.id, activePrompt); } catch (error) { setError((error as Error).message); }
  };

  const tasks = useMemo<BoardTask[]>(() => {
    const out: BoardTask[] = [];
    const items = state.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.kind !== 'user') continue;
      const next = items[i + 1];
      const turn = next && next.kind === 'assistant' ? next : undefined;
      const isLast = !items.slice(i + 1).some((x) => x.kind === 'user');
      let status: BoardTask['status'] = 'done';
      if (isLast && (questions.length > 0 || approvals.length > 0)) status = 'waiting';
      else if (isLast && state.busy) status = 'running';
      else if (turn?.ended?.reason === 'failed') status = 'failed';
      else if (turn?.ended?.reason === 'cancelled') status = 'stopped';
      else if (!turn && !isLast) status = 'done';
      const running = turn?.tools.filter((t) => !t.done).map((t) => t.description ?? t.name) ?? [];
      out.push({ id: it.id, title: it.text.length > 80 ? it.text.slice(0, 80) + '…' : it.text, status, trigger: '用户发起', detail: status === 'running' && running.length > 0 ? `正在：${running.join('，')}` : status === 'running' ? `已完成 ${turn?.tools.filter((t) => t.done).length ?? 0} 步` : undefined });
    }
    return out.toReversed();
  }, [state, questions.length, approvals.length]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <button className="btn text-xs" onClick={onClose}>← 换文件夹</button>
        <div className="font-medium">{workspace.name}</div>
        <div className="muted mono text-xs truncate flex-1">{workspace.root}</div>
        <div className="muted text-xs">{session?.agent_config?.model ?? DEFAULT_MODEL}</div>
        <span className={`tag ${state.busy ? 'tag-run' : 'tag-done'}`}>{state.busy ? 'Agent 工作中' : '空闲'}</span>
      </header>
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        <main className="min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {error && <div className="panel p-3 text-sm" style={{ borderColor: 'var(--danger)' }}>{error}</div>}
            <Timeline items={state.items} />
            {session && questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={async (answers, note) => { await kimi.resolveQuestion(session.id, q.question_id, answers, note); await refreshPending(session.id); }} />)}
            {session && approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} onDecide={async (d, scope) => { await kimi.resolveApproval(session.id, a.approval_id, d, scope); await refreshPending(session.id); }} />)}
            <div ref={bottomRef} />
          </div>
          <div className="p-3 border-t" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="flex gap-2 items-end">
              <textarea ref={taRef} className="flex-1 resize-none" rows={2} placeholder="交代一个任务，Enter 发送，Shift+Enter 换行" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
              {state.busy ? <button className="btn" onClick={() => { void stop(); }}>停止</button> : <button className="btn btn-primary" disabled={!session} onClick={() => { void send(); }}>发送</button>}
            </div>
          </div>
        </main>
        <aside className="min-h-0 overflow-auto p-4 border-l" style={{ borderColor: 'var(--line)' }}>
          <Board tasks={tasks} state={state} connection={connection} />
        </aside>
      </div>
    </div>
  );
}
