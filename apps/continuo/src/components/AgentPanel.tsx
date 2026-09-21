import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Clock, FolderOpen, KanbanSquare, Layers, MessageSquarePlus, PanelRightClose, Plus, ScrollText, Square } from 'lucide-react';
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

const isAwaitingReply = (t: ContinuoTask | null) => !!t && t.status === 'awaiting_user' && t.pendingInteraction === 'reply';

export function AgentPanel(p: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const lastAssistant = p.state.items.at(-1);
  useEffect(() => { if (p.tab === 'chat') bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.tab, p.state.items.length, lastAssistant?.kind === 'assistant' ? lastAssistant.text.length : 0, p.questions.length, p.approvals.length]);

  const needYou = p.doc?.tasks.filter((t) => t.status === 'awaiting_user' || t.status === 'needs_review').length ?? 0;
  const pendingContext = p.doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  const replyMode = isAwaitingReply(p.replyTarget);
  const title = p.tab === 'board' ? '看板' : p.tab === 'context' ? 'Context' : p.tab === 'log' ? '工作日志' : p.selected ? (p.selected.kind === 'init' ? '了解这个工作空间' : p.selected.title) : '新任务';
  const modelName = DEFAULT_MODEL.split('/').pop();

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
            {p.doc && p.doc.init.status === 'running' && (
              <div className="steps-line"><Clock size={14} />正在了解这个文件夹{p.doc.scan ? `：${p.doc.scan.counts.dirs} 个文件夹、${p.doc.scan.counts.files} 个文件` : ''}，只读，不会改动文件。</div>
            )}
            {!p.selected && p.doc && p.doc.init.status !== 'running' && (
              <div className="chat-empty">
                <div className="chat-empty-title">在这个文件夹里交代第一个任务</div>
                <div className="text-3">过程、卡点和产物都会记录在工作空间里，下次打开接着干。</div>
              </div>
            )}
            <Timeline items={p.state.items} emptyHint={p.selected ? '这个任务还没有对话。' : undefined} />
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="chat-footer">
            {p.activeUserTask ? (
              <div className="composer p-3 flex items-center gap-3" style={{ fontSize: 'var(--fs-body)' }}>
                <span className="text-2 flex-1">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '在等你批准上面的操作。' : '在等你回答上面的问题。') : `正在执行「${p.activeUserTask.title}」`}</span>
                <button className="btn btn-sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</button>
              </div>
            ) : (
              <div className="composer">
                <textarea ref={p.composerRef} rows={2} placeholder={replyMode ? '回复这个任务…' : '向 Continuo 交代…'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSend(replyMode ? 'reply' : 'new'); setDraft(''); } }} />
                <div className="composer-footer chrome">
                  <button className="btn btn-icon" title="附加文件（即将支持）" disabled><Plus size={18} /></button>
                  <span className="flex-1" />
                  <span className="model-chip">✳ {modelName}</span>
                  {p.replyTarget && <button className={`btn btn-sm ${replyMode ? 'btn-primary' : ''}`} disabled={!p.doc || p.sending} onClick={() => { p.onSend('reply'); setDraft(''); }}>{replyMode ? '回复' : '追问'}</button>}
                  <button className={`send ${replyMode ? '' : 'is-primary'}`} title="新任务" disabled={!p.doc || p.sending} onClick={() => { p.onSend('new'); setDraft(''); }}><ArrowUp size={16} /></button>
                </div>
              </div>
            )}
            <div className="chat-status chrome">
              <span className="ws-chip"><FolderOpen size={14} />{p.workspaceName}<ChevronDown size={12} /></span>
              <span className="flex-1" />
              {p.connection === 'connecting' && <span className="text-3 fs-meta">连接中…</span>}
              {p.selected && <span className="text-3 fs-meta mono">{p.selected.taskId}</span>}
            </div>
          </div>
        </>
      )}
      {p.tab === 'board' && <div className="pane-body p-4">{p.doc ? <Board doc={p.doc} selectedTaskId={p.selected?.taskId ?? null} onSelect={p.onSelectTask} onAction={p.onAction} /> : <Loading />}</div>}
      {p.tab === 'context' && <div className="pane-body p-4">{p.doc ? <ContextPanel doc={p.doc} onPatch={p.onPatchContext} onOpenFile={p.onOpenFile} /> : <Loading />}</div>}
      {p.tab === 'log' && <div className="pane-body p-4"><pre className="whitespace-pre-wrap mono" style={{ fontSize: 12 }}>{p.workLog || '加载中…'}</pre></div>}
    </aside>
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

function Loading() { return <div className="text-3 fs-meta">打开中…</div>; }
