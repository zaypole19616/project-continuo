import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, KanbanSquare, Layers, MessageSquare, PanelRightClose, ScrollText, Square } from 'lucide-react';
import type { ApprovalRequest, ContextEntry, ContinuoDoc, ContinuoTask, QuestionRequest } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import { Board, type BoardAction } from './Board';
import { ContextPanel } from './ContextPanel';

export type AgentTab = 'chat' | 'board' | 'context' | 'log';

export interface AgentPanelProps {
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
  const candidates = p.doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  const status = !p.doc ? '打开中' : p.doc.init.status === 'running' ? '正在了解文件夹' : p.activeUserTask ? (p.activeUserTask.status === 'awaiting_user' ? '需要你' : '工作中') : '空闲';
  const statusTag = status === '需要你' ? 'tag-wait' : status === '空闲' ? 'tag-neutral' : 'tag-run';
  const replyMode = isAwaitingReply(p.replyTarget);

  return (
    <aside className="pane pane-agent" aria-label="Agent">
      <header className="pane-header chrome">
        <span className="font-medium">Agent</span>
        <span className={`tag ${statusTag}`}>{status}</span>
        <span className="flex-1" />
        {p.connection === 'connecting' && <span className="text-3 fs-meta">连接中</span>}
        <button className="btn btn-icon" title="收起 Agent 面板" onClick={p.onCollapse}><PanelRightClose size={18} /></button>
      </header>
      <div className="px-3 pt-3 chrome">
        <div className="tabs" role="tablist">
          <TabButton active={p.tab === 'chat'} onClick={() => p.onTab('chat')} icon={<MessageSquare size={14} />} label="对话" />
          <TabButton active={p.tab === 'board'} onClick={() => p.onTab('board')} icon={<KanbanSquare size={14} />} label="看板" count={needYou || undefined} />
          <TabButton active={p.tab === 'context'} onClick={() => p.onTab('context')} icon={<Layers size={14} />} label="Context" count={candidates || undefined} />
          <TabButton active={p.tab === 'log'} onClick={() => p.onTab('log')} icon={<ScrollText size={14} />} label="日志" />
        </div>
      </div>
      {p.error && <div className="banner banner-err mx-3 mt-3">{p.error}</div>}
      {p.tab === 'chat' && (
        <>
          <div className="pane-body p-4 space-y-4">
            {p.doc && p.doc.init.status === 'running' && (
              <div className="card-quiet p-3 space-y-1" style={{ fontSize: 'var(--fs-body)' }}>
                <div className="font-medium">正在了解这个文件夹</div>
                {p.doc.scan && <div className="text-3 fs-meta">{p.doc.scan.counts.dirs} 个文件夹、{p.doc.scan.counts.files} 个文件{p.doc.scan.guideFiles.length > 0 ? `，发现指引 ${p.doc.scan.guideFiles.join('、')}` : ''}</div>}
                <div className="text-3 fs-meta">只读，不会改动任何文件。可以先交代任务，会在了解完成后开始。</div>
              </div>
            )}
            {p.selected && (
              <div className="text-3 fs-meta flex items-center gap-2 chrome">
                <span className="truncate">{p.selected.kind === 'init' ? '了解这个工作空间' : p.selected.title}</span>
                {p.selected.trigger === 'resume' && <span className="tag tag-neutral">续接</span>}
              </div>
            )}
            {!p.selected && p.doc && p.doc.init.status !== 'running' && (
              <div className="card-quiet p-4 space-y-1" style={{ fontSize: 'var(--fs-body)' }}>
                <div className="font-medium">还没有任务</div>
                <div className="text-3">交代第一个任务，Continuo 会在这个文件夹里执行，过程和产物都记录在工作空间里。</div>
              </div>
            )}
            <Timeline items={p.state.items} emptyHint={p.selected ? '这个任务还没有对话。' : undefined} />
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="p-3 pt-0 flex-none">
            {p.activeUserTask ? (
              <div className="card-quiet p-3 flex items-center gap-3" style={{ fontSize: 'var(--fs-body)' }}>
                <span className="text-2 flex-1">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '任务在等你批准上面的操作。' : '任务在等你回答上面的问题。') : `正在执行「${p.activeUserTask.title}」，同一时间只跑一个任务。`}</span>
                <button className="btn btn-sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</button>
              </div>
            ) : (
              <div className="composer">
                <textarea ref={p.composerRef} rows={2} placeholder={replyMode ? '回复这个任务；Enter 发送，Shift+Enter 换行' : '交代一个任务；Enter 发送，Shift+Enter 换行'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSend(replyMode ? 'reply' : 'new'); setDraft(''); } }} />
                <div className="composer-footer chrome">
                  <span className="text-3 fs-meta flex-1">{replyMode ? '回复会送回同一个任务会话' : p.replyTarget ? '可以追问上一个任务，或开新任务' : '在当前文件夹里执行'}</span>
                  {p.replyTarget && <button className={`btn btn-sm ${replyMode ? 'btn-primary' : ''}`} disabled={!p.doc || p.sending} onClick={() => { p.onSend('reply'); setDraft(''); }}>{replyMode ? '回复' : '追问'}</button>}
                  <button className={`btn btn-sm ${replyMode ? '' : 'btn-primary'}`} disabled={!p.doc || p.sending} onClick={() => { p.onSend('new'); setDraft(''); }}><ArrowUp size={14} />新任务</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {p.tab === 'board' && <div className="pane-body p-3">{p.doc ? <Board doc={p.doc} selectedTaskId={p.selected?.taskId ?? null} onSelect={p.onSelectTask} onAction={p.onAction} /> : <Loading />}</div>}
      {p.tab === 'context' && <div className="pane-body p-3">{p.doc ? <ContextPanel doc={p.doc} onPatch={p.onPatchContext} onOpenFile={p.onOpenFile} /> : <Loading />}</div>}
      {p.tab === 'log' && <div className="pane-body p-3"><pre className="whitespace-pre-wrap mono" style={{ fontSize: 12 }}>{p.workLog || '加载中…'}</pre></div>}
    </aside>
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number }) {
  return <button role="tab" aria-selected={active} className={`tab ${active ? 'is-active' : ''}`} onClick={onClick}>{icon}{label}{count !== undefined && <span className="count">{count}</span>}</button>;
}

function Loading() { return <div className="text-3 fs-meta">打开中…</div>; }
