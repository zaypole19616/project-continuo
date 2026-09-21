import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Check, CircleAlert, FolderOpen, KanbanSquare, Layers, Loader2, MessageSquarePlus, PanelRightClose, Plus, ScrollText, Square } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import { Board, type BoardAction } from './Board';
import { ContextPanel } from './ContextPanel';

export type AgentTab = 'chat' | 'board' | 'context' | 'log';

export interface AgentPanelProps {
  workspaceName: string;
  doc: ContinuoDoc | null;
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  onCollapse: () => void;
  selected: ContinuoTask | null;
  state: TimelineState;
  questions: QuestionRequest[];
  approvals: ApprovalRequest[];
  connection: string;
  workLog: string;
  error: string | null;
  activeUserTask: ContinuoTask | null;
  replyTarget: ContinuoTask | null;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onSend: (mode: 'new' | 'reply') => void;
  onNewTask: () => void;
  onAnswer: (q: QuestionRequest, answers: Record<string, unknown>, note?: string) => Promise<void>;
  onDecide: (a: ApprovalRequest, d: 'approved' | 'rejected', scope?: 'session') => Promise<void>;
  onAction: (task: ContinuoTask, action: BoardAction) => void;
  onSelectTask: (task: ContinuoTask) => void;
  onPatchContext: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>;
  onOpenFile: (path: string) => void;
}

const SUGGESTIONS = ['基于 materials 里的资料起草一份复盘初稿', '把这个文件夹整理成一份阅读指南', '总结上周新增的材料，列出需要我决定的事'];
const isAwaitingReply = (t: ContinuoTask | null) => !!t && t.status === 'awaiting_user' && t.pendingInteraction === 'reply';

export function AgentPanel(p: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const lastAssistant = p.state.items.at(-1);
  useEffect(() => { if (p.tab === 'chat') bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.tab, p.state.items.length, lastAssistant?.kind === 'assistant' ? lastAssistant.text.length : 0, p.questions.length, p.approvals.length, p.selected?.status]);

  const needYou = p.doc?.tasks.filter((t) => t.status === 'awaiting_user' || t.status === 'needs_review').length ?? 0;
  const pendingContext = p.doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  const replyMode = isAwaitingReply(p.replyTarget);
  const title = p.tab === 'board' ? '看板' : p.tab === 'context' ? 'Context' : p.tab === 'log' ? '工作日志' : p.selected ? (p.selected.kind === 'init' ? '了解这个工作空间' : p.selected.title) : '新任务';
  const modelName = DEFAULT_MODEL.split('/').pop();
  const initRunning = p.doc?.init.status === 'running';
  const showEmpty = !p.selected && p.doc && !initRunning;
  const fill = (text: string) => { setDraft(text); if (p.composerRef.current) { p.composerRef.current.value = text; p.composerRef.current.focus(); } };

  return (
    <aside className="pane pane-agent" aria-label="Agent">
      <header className="chat-header chrome">
        <span className="chat-title truncate" title={title}>{title}</span>
        <span className="flex-1" />
        <HeaderIcon label="新任务" active={false} onClick={p.onNewTask}><MessageSquarePlus size={18} /></HeaderIcon>
        <HeaderIcon label="看板" active={p.tab === 'board'} badge={needYou || undefined} onClick={() => p.onTab(p.tab === 'board' ? 'chat' : 'board')}><KanbanSquare size={18} /></HeaderIcon>
        <HeaderIcon label="Context" active={p.tab === 'context'} badge={pendingContext || undefined} onClick={() => p.onTab(p.tab === 'context' ? 'chat' : 'context')}><Layers size={18} /></HeaderIcon>
        <HeaderIcon label="工作日志" active={p.tab === 'log'} onClick={() => p.onTab(p.tab === 'log' ? 'chat' : 'log')}><ScrollText size={18} /></HeaderIcon>
        <HeaderIcon label="收起面板" active={false} onClick={p.onCollapse}><PanelRightClose size={18} /></HeaderIcon>
      </header>
      {p.error && <div className="banner banner-err mx-4 mt-3">{p.error}</div>}

      {p.tab === 'chat' && (
        <>
          <div className="pane-body chat-body">
            {initRunning && p.doc && (
              <div className="understand fade-in">
                <div className="flex items-center gap-2 font-medium"><Loader2 size={15} className="spin" style={{ color: 'var(--accent)' }} />正在了解这个文件夹</div>
                <div className="t2 sm" style={{ marginTop: 4 }}>{p.doc.scan ? `${p.doc.scan.counts.dirs} 个文件夹、${p.doc.scan.counts.files} 个文件${p.doc.scan.guideFiles.length > 0 ? `，先读 ${p.doc.scan.guideFiles.join('、')}` : ''}。` : ''}只读，不会改动任何文件。</div>
              </div>
            )}
            {showEmpty && (
              <div className="empty-hero fade-in">
                <h2>把工作交给 Continuo</h2>
                <p className="t2" style={{ margin: '0 0 20px' }}>它已经了解了这个文件夹。交代一个任务，过程、卡点和产物都会留在这里。</p>
                <div className="suggest justify-center">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => fill(s)}>{s}</button>)}</div>
              </div>
            )}
            {p.selected && p.selected.kind === 'init' && p.doc?.understanding && (
              <UnderstandingCard doc={p.doc} onContext={() => p.onTab('context')} />
            )}
            <Timeline items={p.state.items} emptyHint={p.selected ? '这个任务还没有对话。' : undefined} />
            {p.selected?.report && (p.selected.report.deliverables.length > 0 || p.selected.report.unresolved.length > 0) && (p.selected.status === 'completed' || p.selected.status === 'needs_review') && (
              <DeliverableCard task={p.selected} onOpenFile={p.onOpenFile} />
            )}
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="chat-footer">
            {p.activeUserTask ? (
              <div className="composer" style={{ padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Loader2 size={16} className="spin" style={{ color: 'var(--accent)' }} />
                <span className="t2 flex-1 sm">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '在等你批准上面的操作' : '在等你回答上面的问题') : `正在执行：${p.activeUserTask.phase ?? p.activeUserTask.title}`}</span>
                <button className="btn btn-sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</button>
              </div>
            ) : (
              <div className="composer">
                <textarea ref={p.composerRef} rows={2} placeholder={replyMode ? '回复这个任务…' : '交代一个任务，或问它这个文件夹里的事…'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSend(replyMode ? 'reply' : 'new'); setDraft(''); } }} />
                <div className="composer-footer chrome">
                  <button className="btn btn-icon" title="附加文件（即将支持）" disabled><Plus size={18} /></button>
                  <span className="model-chip">✳ {modelName}</span>
                  <span className="flex-1" />
                  {p.replyTarget && <button className={`btn btn-sm ${replyMode ? 'btn-primary' : 'btn-ghost'}`} disabled={!p.doc || p.sending} onClick={() => { p.onSend('reply'); setDraft(''); }}>{replyMode ? '回复' : '追问这个任务'}</button>}
                  <button className="send" title={replyMode ? '作为新任务发送' : '发送'} disabled={!p.doc || p.sending} onClick={() => { p.onSend('new'); setDraft(''); }}><ArrowUp size={16} /></button>
                </div>
              </div>
            )}
            <div className="chat-status chrome">
              <span className="ws-chip"><FolderOpen size={13} />{p.workspaceName}</span>
              <span className="flex-1" />
              {p.connection === 'connecting' && <span className="t3 xs">连接中…</span>}
              {p.selected && <span className="t3 xs mono">{p.selected.taskId}</span>}
            </div>
          </div>
        </>
      )}
      {p.tab === 'board' && <div className="pane-body p-4">{p.doc ? <Board doc={p.doc} selectedTaskId={p.selected?.taskId ?? null} onSelect={p.onSelectTask} onAction={p.onAction} /> : <Loading />}</div>}
      {p.tab === 'context' && <div className="pane-body p-4">{p.doc ? <ContextPanel doc={p.doc} onPatch={p.onPatchContext} onOpenFile={p.onOpenFile} /> : <Loading />}</div>}
      {p.tab === 'log' && <div className="pane-body p-4"><pre className="whitespace-pre-wrap mono" style={{ fontSize: 12, lineHeight: 1.6 }}>{p.workLog || '加载中…'}</pre></div>}
    </aside>
  );
}

function UnderstandingCard({ doc, onContext }: { doc: ContinuoDoc; onContext: () => void }) {
  const active = doc.context.filter((e) => e.status === 'active').length;
  const candidates = doc.context.filter((e) => e.status === 'candidate').length;
  return (
    <div className="understand fade-in">
      <div className="font-medium" style={{ marginBottom: 6 }}>我对这个文件夹的理解</div>
      <div className="sm" style={{ lineHeight: 1.65 }}>{doc.understanding!.text}</div>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10 }}>
        <span className="tag tag-done">{active} 条已生效</span>
        {candidates > 0 && <span className="tag tag-wait">{candidates} 条等你确认</span>}
        <span className="flex-1" />
        <button className="btn btn-sm" onClick={onContext}>去确认或纠正</button>
      </div>
    </div>
  );
}

function DeliverableCard({ task, onOpenFile }: { task: ContinuoTask; onOpenFile: (path: string) => void }) {
  const r = task.report!;
  const ok = r.deliverables.filter((d) => d.exists !== false).length;
  return (
    <div className="deliverable fade-in">
      <div className="deliverable-head">
        {task.status === 'completed' ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <CircleAlert size={14} style={{ color: 'var(--warn)' }} />}
        <span className="font-medium">{r.deliverables.length} 个产物</span>
        <span className="t3">· 已核验 {ok} 个存在</span>
        {task.status === 'needs_review' && <span className="tag tag-wait" style={{ marginLeft: 'auto' }}>待复核</span>}
      </div>
      {r.deliverables.map((d) => (
        <div key={d.path} className="deliverable-row">
          {d.exists === false ? <CircleAlert size={13} style={{ color: 'var(--err)' }} /> : <Check size={13} style={{ color: 'var(--ok)' }} />}
          <span className="path" onClick={() => onOpenFile(d.path)} title="在文件区打开">{d.path}</span>
          {d.note && <span className="t3 xs truncate" style={{ maxWidth: '40%' }}>{d.note}</span>}
        </div>
      ))}
      {r.unresolved.map((u) => <div key={u} className="deliverable-row" style={{ color: '#b36b00' }}><CircleAlert size={13} />未解决：{u}</div>)}
    </div>
  );
}

function HeaderIcon({ label, active, badge, onClick, children }: { label: string; active: boolean; badge?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`btn btn-icon hdr-icon ${active ? 'is-active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>
      {children}
      {badge !== undefined && <span className="hdr-badge">{badge}</span>}
    </button>
  );
}

function Loading() { return <div className="t3 sm">打开中…</div>; }
