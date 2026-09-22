import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronDown, CircleAlert, FolderOpen, Loader2, PanelRight, PanelRightClose, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import type { SideMode } from './SidePanel';
import { FolderMenu } from './FolderMenu';
import { Button } from '#/components/ui/button';

export interface AgentPanelProps {
  workspace: Workspace | null;
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
  onPatchContext: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>;
  onStartStep: (prompt: string) => void;
  onPickWorkspace: (w: Workspace) => void;
}

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
  const title = p.selected ? (p.selected.kind === 'init' ? '了解这个文件夹' : p.selected.title) : '新会话';
  const modelName = DEFAULT_MODEL.split('/').pop();
  const hero = p.selected === null;
  const lastMode = useRef<SideMode>('files');
  useEffect(() => { if (p.sideMode !== null) lastMode.current = p.sideMode; }, [p.sideMode]);
  const send = () => { p.onSend(); setDraft(''); };

  const composer = p.activeUserTask ? (
    <div className="composer" style={{ padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Loader2 size={16} className="spin" style={{ color: 'var(--accent)' }} />
      <span className="t2 flex-1 sm">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '要动你的文件，等你点允许' : '有一个决定需要你') : `正在做：${p.activeUserTask.phase ?? p.activeUserTask.title}`}</span>
      <Button size="sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</Button>
    </div>
  ) : (
    <>
      {p.continueTarget && (p.continueTarget.status === 'paused' || p.continueTarget.status === 'interrupted' || p.continueTarget.status === 'failed' || p.continueTarget.status === 'needs_review') && (
        <div className="state-bar chrome">
          <span className="t2 sm flex-1">{p.continueTarget.status === 'paused' ? '已暂停，工作留在这里' : p.continueTarget.status === 'interrupted' ? '被打断了，可以接着做' : p.continueTarget.status === 'failed' ? '这次没做完，可以再试' : '还差一点，还没算完成'}</span>
          {p.continueTarget.status === 'needs_review' && <Button size="sm" onClick={() => p.onAction(p.continueTarget!, 'complete')}><Check size={12} />标记完成</Button>}
          <Button variant="default" size="sm" onClick={() => p.onAction(p.continueTarget!, 'resume')}>{p.continueTarget.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</Button>
        </div>
      )}
      {hero && (
        <div className="hero-chip-row">
          <FolderMenu
            currentId={p.workspace?.id}
            onPick={p.onPickWorkspace}
            trigger={
              <button className={`ws-chip ws-chip-btn ${p.workspace === null ? 'is-empty' : ''}`} title="选择文件夹">
                <FolderOpen size={13} />{p.workspace?.name ?? '选择文件夹'}<ChevronDown size={12} />
              </button>
            }
          />
        </div>
      )}
      <div className="composer">
        <textarea ref={p.composerRef} rows={hero ? 3 : 2} placeholder={p.workspace === null ? '先选一个文件夹，再交代任务…' : awaitingReply ? '回复它…' : continuing ? '有新的要求？直接说…' : '这次想完成什么？'} value={draft} disabled={p.workspace === null} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <div className="composer-footer chrome">
          <span className="model-chip">✳ {modelName}</span>
          <span className="flex-1" />
          <button className="send" title="发送" disabled={!p.doc || p.sending} onClick={send}><ArrowUp size={16} /></button>
        </div>
      </div>
      <div className="chat-status chrome">
        <span className="t3 xs">{p.workspace === null ? '先在上面选一个文件夹' : p.connection === 'connecting' ? '连接中…' : continuing ? '会在这个会话里接着干；要另起一个，点左上角「新会话」' : 'Enter 发送 · Shift + Enter 换行'}</span>
      </div>
    </>
  );

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

      <div className={`pane-body chat-body ${hero ? 'is-hero' : ''}`}>
        <div className="chat-col">
          {hero && (
            <div className="hero fade-in">
              <div className="wordmark">Contin<i>uo</i></div>
              {p.workspace === null
                ? <p className="t2 hero-brief">选一个文件夹交给它：先了解这个文件夹，再接你交代的任务，做完的东西放回文件夹。</p>
                : p.doc && (p.doc.init.status === 'running'
                    ? <p className="t3 sm hero-brief">它正在了解这个文件夹，进度在右边；有想做的事可以直接说。</p>
                    : <p className="t3 sm hero-brief">{memorySummary(p.doc)}<button className="link" onClick={() => p.onSide('context')}>{p.doc.context.some((e) => e.status === 'candidate') ? '去确认' : '查看'}</button></p>)}
              <div className="hero-composer">{composer}</div>
            </div>
          )}
          {!hero && <Timeline items={p.state.items} emptyHint="这个会话还没有内容。" />}
          {p.selected && p.doc && p.selected.kind === 'user' && (p.selected.status === 'completed' || p.selected.status === 'needs_review') && (
            <ClosingCard task={p.selected} doc={p.doc} onOpenFile={p.onOpenFile} />
          )}
          {p.selected?.report?.nextStep && p.selected.status !== 'running' && !p.doc?.tasks.some((t) => t.title === p.selected!.report!.nextStep!.prompt.slice(0, 120)) && (
            <NextStepCard step={p.selected.report.nextStep} busy={p.sending} onStart={() => p.onStartStep(p.selected!.report!.nextStep!.prompt)} />
          )}
          {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
          {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} root={p.doc?.root} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
          {isAwaitingReply(p.selected) && p.selected?.lastReply && (
            <div className="banner banner-warn">在下面回复它，它会接着干。</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {!hero && <div className="chat-footer"><div className="chat-col">{composer}</div></div>}
    </section>
  );
}

function ClosingCard({ task, doc, onOpenFile }: { task: ContinuoTask; doc: ContinuoDoc; onOpenFile: (path: string) => void }) {
  const deliverables = task.report?.deliverables ?? [];
  const nextStep = task.report?.nextStep;
  const unresolved = (task.report?.unresolved ?? []).filter((item) => nextStep === undefined || !coveredBy(item, nextStep));
  const ok = deliverables.filter((d) => d.exists !== false).length;
  const remembered = doc.context.filter((e) => e.taskId === task.taskId && e.kind !== 'progress' && (e.status === 'active' || e.status === 'candidate'));
  const done = task.status === 'completed';
  return (
    <div className="space-y-2">
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

function memorySummary(doc: ContinuoDoc): string {
  const remembered = doc.context.filter((e) => e.status === 'active').length;
  const pending = doc.context.filter((e) => e.status === 'candidate').length;
  if (remembered === 0 && pending === 0) return '它已经了解了这个文件夹。';
  return pending > 0 ? `记住了 ${remembered} 件事，还有 ${pending} 条推断等你确认。` : `记住了 ${remembered} 件事。`;
}

function coveredBy(item: string, step: { title: string; reason: string }): boolean {
  const key = step.title.replaceAll(/[\s，。、]/g, '');
  if (key.length < 4) return false;
  const text = item.replaceAll(/[\s，。、]/g, '');
  return text.includes(key) || step.reason.replaceAll(/[\s，。、]/g, '').includes(text);
}

function NextStepCard({ step, busy, onStart }: { step: { title: string; reason: string; prompt: string }; busy: boolean; onStart: () => void }) {
  return (
    <div className="space-y-2">
      <div className="next-step fade-in">
        <div className="next-step-head"><Sparkles size={15} />接下来，也许值得做这一步</div>
        <div className="next-step-title">{step.title}</div>
        <div className="t2 sm">{step.reason}</div>
        <div className="flex">
          <span className="flex-1" />
          <Button variant="default" size="sm" disabled={busy} onClick={onStart}>开始这一步<ArrowRight size={13} /></Button>
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
