import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, Check, CircleAlert, FolderOpen, Loader2, PanelRight, PanelRightClose, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import type { SideMode } from './SidePanel';
import { shortDate } from './Sidebar';

export interface AgentPanelProps {
  workspaceName: string;
  doc: ContinuoDoc | null;
  sideMode: SideMode | null;
  onSide: (mode: SideMode | null) => void;
  selected: ContinuoTask | null;
  state: TimelineState;
  questions: QuestionRequest[];
  approvals: ApprovalRequest[];
  connection: string;
  error: string | null;
  activeUserTask: ContinuoTask | null;
  continueTarget: ContinuoTask | null;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onSend: () => void;
  onAnswer: (q: QuestionRequest, answers: Record<string, unknown>, note?: string) => Promise<void>;
  onDecide: (a: ApprovalRequest, d: 'approved' | 'rejected', scope?: 'session') => Promise<void>;
  onAction: (task: ContinuoTask, action: 'pause' | 'resume' | 'complete') => void;
  onOpenFile: (path: string) => void;
  onAbout: (bet: string) => void;
  onPatchContext: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>;
  onReunderstand: () => void;
  onStartStep: (prompt: string) => void;
}

export type BetKey = 'orderliness' | 'proactiveness' | 'clarity';
export const BET_LABEL: Record<BetKey, string> = { orderliness: '有条理', proactiveness: '不乱打扰', clarity: '说清楚' };

const isAwaitingReply = (t: ContinuoTask | null) => !!t && t.status === 'awaiting_user' && t.pendingInteraction === 'reply';

export function AgentPanel(p: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const lastAssistant = p.state.items.at(-1);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.state.items.length, lastAssistant?.kind === 'assistant' ? lastAssistant.text.length : 0, p.questions.length, p.approvals.length, p.selected?.status]);

  const needYou = p.doc?.tasks.filter((t) => t.status === 'awaiting_user' || t.status === 'needs_review').length ?? 0;
  const pendingContext = p.doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  const continuing = p.continueTarget !== null;
  const awaitingReply = isAwaitingReply(p.continueTarget);
  const title = p.selected ? (p.selected.kind === 'init' ? '了解这个文件夹' : p.selected.title) : '新任务';
  const modelName = DEFAULT_MODEL.split('/').pop();
  const initRunning = p.doc?.init.status === 'running';
  const showEmpty = !p.selected && p.doc && !initRunning;
  const lastMode = useRef<SideMode>('files');
  useEffect(() => { if (p.sideMode !== null) lastMode.current = p.sideMode; }, [p.sideMode]);

  return (
    <section className="pane pane-main" aria-label="对话">
      <header className="chat-header chrome">
        <span className="chat-title truncate" title={title}>{title}</span>
        <span className="flex-1" />
        {p.sideMode === null
          ? <HeaderIcon label="打开右侧面板" active={false} badge={(needYou + pendingContext) || undefined} onClick={() => p.onSide(lastMode.current)}><PanelRight size={18} /></HeaderIcon>
          : <HeaderIcon label="收起右侧面板" active={false} onClick={() => { lastMode.current = p.sideMode ?? 'files'; p.onSide(null); }}><PanelRightClose size={18} /></HeaderIcon>}
      </header>
      {p.error && <div className="banner banner-err mx-auto mt-3" style={{ maxWidth: 760 }}>{p.error}</div>}

      <div className="pane-body chat-body">
        <div className="chat-col">
          {initRunning && p.doc && <InitStage startedAt={p.doc.init.startedAt} />}
          {showEmpty && p.doc && (
            <div className="empty-hero fade-in">
              <h2>{p.doc.tasks.some((t) => t.kind === 'user') ? '这次，想做什么？' : '准备好了，开始吧。'}</h2>
              {p.doc.understanding && <p className="t2 empty-brief">{p.doc.understanding.text}</p>}
              <p className="t3 sm" style={{ margin: '0 0 22px' }}>{memorySummary(p.doc)}<button className="link" onClick={() => p.onSide('context')}>{p.doc.context.some((e) => e.status === 'candidate') ? '去确认' : '查看'}</button></p>
            </div>
          )}
          {p.selected && p.selected.kind === 'init' && p.doc?.understanding && (
            <UnderstandingCard doc={p.doc} onContext={() => p.onSide('context')} onAbout={() => p.onAbout('clarity')} onReunderstand={p.onReunderstand} />
          )}
          {!showEmpty && !initRunning && <Timeline items={p.selected?.kind === 'init' ? p.state.items.filter((it) => it.kind !== 'user') : p.state.items} emptyHint={p.selected ? (p.selected.kind === 'init' ? undefined : p.selected.sessionId === '' ? `这是演示夹自带的上次任务（${shortDate(p.selected.createdAt)}），对话没有随演示夹保存；下面是它当时的收尾。` : '这个任务还没有对话。') : undefined} />}
          {p.selected && p.doc && p.selected.kind === 'user' && (p.selected.status === 'completed' || p.selected.status === 'needs_review') && (
            <ClosingCard task={p.selected} doc={p.doc} onOpenFile={p.onOpenFile} onAbout={() => p.onAbout('clarity')} />
          )}
          {p.selected?.report?.nextStep && p.selected.status !== 'running' && !p.doc?.tasks.some((t) => t.title === p.selected!.report!.nextStep!.prompt.slice(0, 120)) && (
            <NextStepCard step={p.selected.report.nextStep} busy={p.sending} onStart={() => p.onStartStep(p.selected!.report!.nextStep!.prompt)} onAbout={() => p.onAbout('proactiveness')} />
          )}
          {p.questions.map((q) => <div key={q.question_id} className="space-y-2"><BetChip bet="proactiveness" note="需要你决定时才打扰" onClick={() => p.onAbout('proactiveness')} /><QuestionCard q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} /></div>)}
          {p.approvals.map((a) => <div key={a.approval_id} className="space-y-2"><BetChip bet="proactiveness" note="动你的文件前先问你" onClick={() => p.onAbout('proactiveness')} /><ApprovalCard a={a} root={p.doc?.root} onDecide={(d, scope) => p.onDecide(a, d, scope)} /></div>)}
          {isAwaitingReply(p.selected) && p.selected?.lastReply && (
            <div className="banner banner-warn"><BetChip bet="proactiveness" note="它在等你回复，不会假装完成" onClick={() => p.onAbout('proactiveness')} />在下面回复它，它会接着干。</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="chat-footer">
        <div className="chat-col">
          {p.activeUserTask ? (
            <div className="composer" style={{ padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={16} className="spin" style={{ color: 'var(--accent)' }} />
              <span className="t2 flex-1 sm">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '要动你的文件，等你点允许' : '有一个决定需要你') : `正在做：${p.activeUserTask.phase ?? p.activeUserTask.title}`}</span>
              <button className="btn btn-sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</button>
            </div>
          ) : (
            <>
              {p.continueTarget && (p.continueTarget.status === 'paused' || p.continueTarget.status === 'interrupted' || p.continueTarget.status === 'failed' || p.continueTarget.status === 'needs_review') && (
                <div className="state-bar chrome">
                  <span className="t2 sm flex-1">{p.continueTarget.status === 'paused' ? '已暂停，工作留在这里' : p.continueTarget.status === 'interrupted' ? '被打断了，可以接着做' : p.continueTarget.status === 'failed' ? '这次没做完，可以再试' : '还差一点，还没算完成'}</span>
                  {p.continueTarget.status === 'needs_review' && <button className="btn btn-sm" onClick={() => p.onAction(p.continueTarget!, 'complete')}><Check size={12} />标记完成</button>}
                  <button className="btn btn-sm btn-primary" onClick={() => p.onAction(p.continueTarget!, 'resume')}>{p.continueTarget.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</button>
                </div>
              )}
              <div className="composer">
                <textarea ref={p.composerRef} rows={2} placeholder={awaitingReply ? '回复它…' : continuing ? '有新的要求？直接说…' : '这次想完成什么？'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSend(); setDraft(''); } }} />
                <div className="composer-footer chrome">
                  <span className="model-chip">✳ {modelName}</span>
                  <span className="ws-chip"><FolderOpen size={13} />{p.workspaceName}</span>
                  <span className="flex-1" />
                  <button className="send" title="发送" disabled={!p.doc || p.sending} onClick={() => { p.onSend(); setDraft(''); }}><ArrowUp size={16} /></button>
                </div>
              </div>
            </>
          )}
          <div className="chat-status chrome">
            <span className="t3 xs">{p.connection === 'connecting' ? '连接中…' : continuing ? '会在这个任务里接着干；要另起一个，点左上角「新任务」' : 'Enter 发送 · Shift + Enter 换行'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BetChip({ bet, note, onClick }: { bet: BetKey; note?: string; onClick: () => void }) {
  return <button className="bet-chip chrome" onClick={onClick} title="这背后的想法">{BET_LABEL[bet]}{note ? <span className="t3"> · {note}</span> : null}</button>;
}

function UnderstandingCard({ doc, onContext, onAbout, onReunderstand }: { doc: ContinuoDoc; onContext: () => void; onAbout: () => void; onReunderstand: () => void }) {
  const active = doc.context.filter((e) => e.status === 'active').length;
  const candidates = doc.context.filter((e) => e.status === 'candidate').length;
  return (
    <div className="understand fade-in space-y-3">
      <div>
        <BetChip bet="clarity" note="每条理解都有来源，确认了才会用" onClick={onAbout} />
        <div className="font-medium" style={{ margin: '6px 0' }}>我对这个文件夹的理解</div>
        <div className="sm" style={{ lineHeight: 1.65 }}>{doc.understanding!.text}</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="sm t2">记住了 {active} 件事{candidates > 0 ? `，还有 ${candidates} 条推断等你确认` : ''}</span>
        <span className="flex-1" />
        <button className="btn btn-sm btn-ghost" title="再读一遍文件夹，重新形成理解（约一分钟）" onClick={onReunderstand}><RotateCcw size={12} />重新了解</button>
        <button className="btn btn-sm" onClick={onContext}>{candidates > 0 ? '去确认' : '查看或修改'}</button>
      </div>
    </div>
  );
}

function ClosingCard({ task, doc, onOpenFile, onAbout }: { task: ContinuoTask; doc: ContinuoDoc; onOpenFile: (path: string) => void; onAbout: () => void }) {
  const deliverables = task.report?.deliverables ?? [];
  const unresolved = task.report?.unresolved ?? [];
  const ok = deliverables.filter((d) => d.exists !== false).length;
  const remembered = doc.context.filter((e) => e.taskId === task.taskId && e.kind !== 'progress' && (e.status === 'active' || e.status === 'candidate'));
  const done = task.status === 'completed';
  return (
    <div className="space-y-2">
      <BetChip bet="clarity" note="做没做完，看文件说话" onClick={onAbout} />
      <div className="deliverable fade-in">
        <div className="deliverable-head">
          {done ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <CircleAlert size={14} style={{ color: 'var(--warn)' }} />}
          <span className="font-medium">{done ? '这个任务做完了' : '还差一点'}</span>
          <span className="t3">· {deliverables.length > 0 ? `做出 ${deliverables.length} 份文件，${ok} 份已确认在文件夹里` : '没有新文件'}</span>
        </div>
        {deliverables.map((d) => (
          <div key={d.path} className="deliverable-row">
            {d.exists === false ? <CircleAlert size={13} style={{ color: 'var(--err)' }} /> : <Check size={13} style={{ color: 'var(--ok)' }} />}
            <span className="path" onClick={() => onOpenFile(d.path)} title="在右侧打开">{d.path}</span>
            {d.exists === false && <span className="t3 xs">没找到这个文件</span>}
            {d.note && d.exists !== false && <span className="t3 xs truncate" style={{ maxWidth: '40%' }}>{d.note}</span>}
          </div>
        ))}
        {unresolved.map((u) => <div key={u} className="deliverable-row" style={{ color: '#b36b00' }}><CircleAlert size={13} />还没做到：{u}</div>)}
        {remembered.length > 0 && (
          <div className="deliverable-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <span className="t3 xs">这次记住了</span>
            {remembered.slice(0, 4).map((e) => (
              <span key={e.id} className="flex items-start gap-2">
                <Check size={13} style={{ color: e.status === 'active' ? 'var(--ok)' : 'var(--warn)', marginTop: 3, flex: 'none' }} />
                <span>{e.text}{e.status === 'candidate' && <span className="t3"> · 等你确认</span>}</span>
              </span>
            ))}
          </div>
        )}
        {(task.sources ?? []).length > 0 && (
          <details className="deliverable-row" style={{ display: 'block' }}>
            <summary className="t3 xs" style={{ cursor: 'pointer' }}>读过的资料 · {(task.sources ?? []).length} 份</summary>
            <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
              {(task.sources ?? []).map((path) => <button key={path} className="tag tag-neutral" style={{ cursor: 'pointer' }} onClick={() => onOpenFile(path)}>{path}</button>)}
            </div>
          </details>
        )}
        <div className="deliverable-row t3" style={{ fontSize: 'var(--fs-xs)' }}>
          {done ? '下次打开这个文件夹，它记住的事都还在，不用再交代一遍。' : '补完上面的事再标记完成；记住的事已经保存，不会丢。'}
        </div>
      </div>
    </div>
  );
}

const INIT_STAGES: Array<[number, string]> = [[0, '正在了解你现有的工作…'], [12, '正在整理项目的背景和约定…'], [30, '正在分析材料…'], [55, '快好了，请稍候…']];

function InitStage({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const elapsed = startedAt ? (now - new Date(startedAt).getTime()) / 1000 : 0;
  const text = INIT_STAGES.findLast(([at]) => elapsed >= at)![1];
  return (
    <div className="init-stage fade-in">
      <span className="init-orb"><Loader2 size={22} className="spin" /></span>
      <div className="init-title" key={text}>{text}</div>
      <div className="t3 sm">它只读不改。有想做的事，直接在下面告诉它，不必等它读完。</div>
    </div>
  );
}

function memorySummary(doc: ContinuoDoc): string {
  const remembered = doc.context.filter((e) => e.status === 'active').length;
  const pending = doc.context.filter((e) => e.status === 'candidate').length;
  if (remembered === 0 && pending === 0) return '它已经了解了这个文件夹。';
  return pending > 0 ? `记住了 ${remembered} 件事，还有 ${pending} 条推断等你确认。` : `记住了 ${remembered} 件事。`;
}

function NextStepCard({ step, busy, onStart, onAbout }: { step: { title: string; reason: string; prompt: string }; busy: boolean; onStart: () => void; onAbout: () => void }) {
  return (
    <div className="space-y-2">
      <BetChip bet="proactiveness" note="下一步由你决定要不要开始" onClick={onAbout} />
      <div className="next-step fade-in">
        <div className="next-step-head"><Sparkles size={15} />接下来，也许值得做这一步</div>
        <div className="next-step-title">{step.title}</div>
        <div className="t2 sm">{step.reason}</div>
        <div className="flex">
          <span className="flex-1" />
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onStart}>开始这一步<ArrowRight size={13} /></button>
        </div>
      </div>
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
