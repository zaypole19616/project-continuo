import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, CircleAlert, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import { InitStatus } from './InitStatus';
import { WorkRecord } from './WorkRecord';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';

export interface DrawerProps {
  workspace: Workspace;
  doc: ContinuoDoc | null;
  latest: ContinuoTask | null;
  state: TimelineState;
  questions: QuestionRequest[];
  approvals: ApprovalRequest[];
  error: string | null;
  activeUserTask: ContinuoTask | null;
  replyTarget: ContinuoTask | null;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onSend: () => void;
  onAnswer: (q: QuestionRequest, answers: Record<string, unknown>, note?: string) => Promise<void>;
  onDecide: (a: ApprovalRequest, d: 'approved' | 'rejected', scope?: 'session') => Promise<void>;
  onAction: (task: ContinuoTask, action: 'pause' | 'resume' | 'complete') => void;
  onOpenFile: (path: string) => void;
  onStartStep: (prompt: string) => void;
  onError: (message: string) => void;
}

type Tab = 'chat' | 'log' | 'todo';

const RESUMABLE = new Set(['paused', 'interrupted', 'failed', 'needs_review']);
const isFinished = (t: ContinuoTask) => t.status === 'completed' || t.status === 'needs_review';

function statusLabel(task: ContinuoTask): string {
  switch (task.status) {
    case 'queued': return '排队中';
    case 'running': return task.phase ?? '进行中';
    case 'verifying': return '核对产物';
    case 'awaiting_user': return task.pendingInteraction === 'question' ? '等你回答' : task.pendingInteraction === 'approval' ? '等你批准' : '等你回复';
    case 'paused': return '已暂停';
    case 'interrupted': return '被打断了';
    case 'failed': return `没做完${task.lastError ? ` · ${task.lastError}` : ''}`;
    case 'needs_review': return '还差一点';
    default: return '';
  }
}

function statusDot(task: ContinuoTask): string {
  if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued') return 'running';
  if (task.status === 'awaiting_user') return 'waiting';
  if (task.status === 'failed' || task.status === 'interrupted') return 'failed';
  return '';
}

export function Drawer(p: DrawerProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastItem = p.state.items.at(-1);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.state.items.length, lastItem?.kind === 'assistant' ? lastItem.text.length : 0, p.questions.length, p.approvals.length, p.latest?.status]);

  const tasks = p.doc?.tasks.filter((t) => t.kind === 'user') ?? [];
  const todos = tasks.filter((t) => t.status !== 'completed');
  const reading = p.doc?.init.status === 'running';
  const running = p.activeUserTask !== null && p.activeUserTask.status !== 'awaiting_user';
  const resumable = p.latest !== null && RESUMABLE.has(p.latest.status) ? p.latest : null;
  const modelName = DEFAULT_MODEL.split('/').pop();
  const send = () => { p.onSend(); setDraft(''); };
  const stop = () => { if (p.activeUserTask) p.onAction(p.activeUserTask, 'pause'); };
  const focusComposer = () => { setTab('chat'); setTimeout(() => p.composerRef.current?.focus(), 50); };

  const anchored = new Map<number, ContinuoTask[]>();
  const trailing: ContinuoTask[] = [];
  for (const task of tasks.filter((t) => isFinished(t) && t.endedAt !== undefined)) {
    const end = Date.parse(task.endedAt!);
    let index = -1;
    p.state.items.forEach((item, i) => { if (item.at <= end) index = i; });
    if (index === -1) trailing.push(task);
    else anchored.set(index, [...(anchored.get(index) ?? []), task]);
  }
  const nextStep = p.latest?.report?.nextStep;
  const showNextStep = nextStep !== undefined && p.latest !== null && isFinished(p.latest) && !tasks.some((t) => t.title === nextStep.prompt.slice(0, 120));
  const card = (task: ContinuoTask) => p.doc && <ClosingCard key={task.taskId} task={task} doc={p.doc} onOpenFile={p.onOpenFile} />;

  const composer = (
    <>
      {resumable && (
        <div className="state-bar chrome">
          <span className="t2 sm flex-1">{resumable.status === 'paused' ? '已暂停，工作留在这里' : resumable.status === 'interrupted' ? '被打断了，可以接着做' : resumable.status === 'failed' ? '这次没做完，可以再试' : '还差一点，还没算完成'}</span>
          {resumable.status === 'needs_review' && <Button size="sm" onClick={() => p.onAction(resumable, 'complete')}><Check size={12} />标记完成</Button>}
          <Button variant="default" size="sm" onClick={() => p.onAction(resumable, 'resume')}>{resumable.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</Button>
        </div>
      )}
      <div className="composer">
        <textarea
          ref={p.composerRef}
          rows={2}
          placeholder={p.replyTarget ? '回复它…' : '这次想完成什么？'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running && !p.sending) send(); } }}
        />
        <div className="composer-footer chrome">
          <span className="model-chip">✳ {modelName}</span>
          <span className="flex-1" />
          {running
            ? <button className="send" title="停止" onClick={stop}><Square size={13} fill="currentColor" /></button>
            : <button className="send" title="发送" disabled={!p.doc || p.sending} onClick={send}><ArrowUp size={16} /></button>}
        </div>
      </div>
    </>
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="panel-box drawer" aria-label="对话" asChild>
      <aside>
        <div className="drawer-head">
          <TabsList>
            <TabsTrigger value="chat">对话</TabsTrigger>
            <TabsTrigger value="log">记录</TabsTrigger>
            <TabsTrigger value="todo">事项{todos.length > 0 && <span className="mode-badge">{todos.length}</span>}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          {p.error && <div className="banner banner-err mb-2">{p.error}</div>}
          <div className="drawer-body">
            {reading && p.doc && <InitStatus doc={p.doc} />}
            {p.state.items.length > 0 && <Timeline items={p.state.items} after={(_, i) => anchored.get(i)?.map(card)} />}
            {trailing.map(card)}
            {showNextStep && <NextStepCard step={nextStep} busy={p.sending} onStart={() => p.onStartStep(nextStep.prompt)} />}
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} root={p.doc?.root} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="drawer-foot">{composer}</div>
        </TabsContent>
        <TabsContent value="log" className="drawer-body">
          {p.doc ? <WorkRecord workspaceId={p.workspace.id} revision={p.doc.revision} onError={p.onError} /> : <div className="t3 sm">打开中…</div>}
        </TabsContent>
        <TabsContent value="todo" className="drawer-body">
          {todos.length === 0
            ? <div className="t3 sm">没有进行中的事项。</div>
            : todos.toReversed().map((task) => (
              <div key={task.taskId} className="todo-row">
                <span className={`status-dot ${statusDot(task)}`} />
                <div className="min-w-0 flex-1">
                  <div className="todo-title">{task.title}</div>
                  <div className="todo-meta">{statusLabel(task)}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {(task.status === 'running' || task.status === 'queued') && <Button variant="ghost" size="sm" onClick={() => p.onAction(task, 'pause')}><Square size={11} fill="currentColor" />停止</Button>}
                  {task.status === 'awaiting_user' && <Button variant="ghost" size="sm" onClick={focusComposer}><ArrowRight size={12} />去回复</Button>}
                  {task.status === 'needs_review' && <Button variant="ghost" size="sm" onClick={() => p.onAction(task, 'complete')}><Check size={12} />标记完成</Button>}
                  {RESUMABLE.has(task.status) && <Button variant="ghost" size="sm" onClick={() => p.onAction(task, 'resume')}>{task.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</Button>}
                </div>
              </div>
            ))}
        </TabsContent>
      </aside>
    </Tabs>
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
    <div className="deliverable fade-in">
      <div className="deliverable-head">
        {done ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <CircleAlert size={14} style={{ color: 'var(--warn)' }} />}
        <span className="font-medium">{done ? '做完了' : '还差一点'}</span>
        <span className="t3">· {deliverables.length > 0 ? `${deliverables.length} 份文件，${ok} 份已确认在项目里` : '没有新文件'}</span>
      </div>
      {deliverables.map((d) => (
        <div key={d.path} className="deliverable-row">
          {d.exists === false ? <CircleAlert size={13} style={{ color: 'var(--err)' }} /> : <Check size={13} style={{ color: 'var(--ok)' }} />}
          <span className="path" onClick={() => onOpenFile(d.path)} title="在左侧打开">{d.path}</span>
          {d.exists === false && <span className="t3 xs">没找到这个文件</span>}
        </div>
      ))}
      {unresolved.map((u) => <div key={u} className="deliverable-row" style={{ color: 'var(--warn)' }}><CircleAlert size={13} />还没做到：{u}</div>)}
      {remembered.length > 0 && (
        <div className="deliverable-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span className="t3 xs">这次记住了</span>
          {remembered.slice(0, 4).map((e) => (
            <span key={e.id} className="flex items-start gap-2">
              <Check size={13} style={{ color: 'var(--ok)', marginTop: 3, flex: 'none' }} />
              <span>{e.text}</span>
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
    </div>
  );
}

function coveredBy(item: string, step: { title: string; reason: string }): boolean {
  const key = step.title.replaceAll(/[\s，。、]/g, '');
  if (key.length < 4) return false;
  const text = item.replaceAll(/[\s，。、]/g, '');
  return text.includes(key) || step.reason.replaceAll(/[\s，。、]/g, '').includes(text);
}

function NextStepCard({ step, busy, onStart }: { step: { title: string; reason: string; prompt: string }; busy: boolean; onStart: () => void }) {
  return (
    <div className="next-step fade-in">
      <div className="next-step-head"><Sparkles size={15} />接下来，也许值得做这一步</div>
      <div className="next-step-title">{step.title}</div>
      <div className="t2 sm">{step.reason}</div>
      <div className="flex">
        <span className="flex-1" />
        <Button variant="default" size="sm" disabled={busy} onClick={onStart}>开始这一步<ArrowRight size={13} /></Button>
      </div>
    </div>
  );
}
