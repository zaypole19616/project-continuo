import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, CircleAlert, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContinuoDoc, type ContinuoTask, type ContinuoTodo, type Decision, type PermissionMode, type TodoTiming, type QuestionRequest, type Trajectory, type TrajectoryPlan, type Workspace } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { decisionsOn, lineIsBusy, taskLabel, tasksOn, todoGroup, TODO_GROUPS } from '#/lib/trajectory';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import { InitCard } from './InitCard';
import { Backlog } from './Backlog';
import { failureReason } from '#/lib/errors';
import { PermissionPicker } from './PermissionPicker';
import { ErrorCard } from './ErrorCard';
import { DecisionCard } from './DecisionCard';
import { TrajectoryTree } from './TrajectoryTree';
import { AbandonDialog } from './AbandonDialog';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';

export interface DrawerProps {
  workspace: Workspace;
  doc: ContinuoDoc | null;
  line: Trajectory | undefined;
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
  onAction: (task: ContinuoTask, action: 'pause' | 'resume') => void;
  onOpenFile: (path: string) => void;
  onRetryInit: () => void;
  onAddTodo: (text: string, timing: TodoTiming | undefined) => Promise<boolean>;
  onTodoAction: (todo: ContinuoTodo, action: 'start' | 'delete') => Promise<boolean>;
  onPermission: (mode: PermissionMode) => void;
  onStartStep: (prompt: string) => void;
  onChoose: (decision: Decision, plan: TrajectoryPlan) => Promise<boolean>;
  onExpand: (decision: Decision) => Promise<boolean>;
  onAbandon: (decision: Decision, plan: TrajectoryPlan, reason: string) => void;
  onSwitch: (line: Trajectory) => void;
  onForkAfter: (task: ContinuoTask) => Promise<boolean>;
}

type Tab = 'chat' | 'todo' | 'tree';

const RESUMABLE = new Set(['paused', 'interrupted', 'failed', 'needs_review']);
const CONTINUABLE = new Set(['paused', 'interrupted', 'needs_review']);
const GO_LABEL: Record<string, string> = { choice: '去选', question: '去回答', approval: '去批准', reply: '去回复' };
const isFinished = (t: ContinuoTask) => t.status === 'completed' || t.status === 'needs_review';

function statusLabel(task: ContinuoTask): string {
  switch (task.status) {
    case 'queued': return '排队中';
    case 'running': return task.phase ?? '进行中';
    case 'verifying': return '核对产物';
    case 'awaiting_user': return task.pendingInteraction === 'choice' ? '等你选方案' : task.pendingInteraction === 'question' ? '等你回答' : task.pendingInteraction === 'approval' ? '等你批准' : '等你回复';
    case 'paused': return '已暂停';
    case 'interrupted': return '被打断了';
    case 'failed': { const reason = failureReason(task); return `没做成${reason === undefined ? '' : ` · ${reason}`}`; }
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
  const [dropping, setDropping] = useState<{ decision: Decision; plan: TrajectoryPlan } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastItem = p.state.items.at(-1);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.state.items.length, lastItem?.kind === 'assistant' ? lastItem.text.length : 0, p.questions.length, p.approvals.length, p.latest?.status]);

  const tasks = p.doc === null ? [] : tasksOn(p.doc, p.line);
  const todos = tasks.filter((t) => t.status !== 'completed');
  const running = p.activeUserTask !== null && p.activeUserTask.status !== 'awaiting_user';
  const resumable = p.latest !== null && CONTINUABLE.has(p.latest.status) ? p.latest : null;
  const modelName = DEFAULT_MODEL.split('/').pop();
  const send = () => { p.onSend(); setDraft(''); };
  const stop = () => { if (p.activeUserTask) p.onAction(p.activeUserTask, 'pause'); };
  const focusComposer = () => { setTab('chat'); setTimeout(() => p.composerRef.current?.focus(), 50); };
  const locked = p.sending || (p.doc !== null && lineIsBusy(p.doc, p.line));
  const planActions = {
    onChoose: (decision: Decision, plan: TrajectoryPlan) => { void p.onChoose(decision, plan).then((ok) => { if (ok) setTab('chat'); }); },
    onExpand: (decision: Decision) => { void p.onExpand(decision).then((ok) => { if (ok) setTab('chat'); }); },
    onAbandon: (decision: Decision, plan: TrajectoryPlan) => setDropping({ decision, plan }),
    onSwitch: p.onSwitch,
    onOpenFile: p.onOpenFile,
  };
  const treeActions = { ...planActions, onForkAfter: (task: ContinuoTask) => { void p.onForkAfter(task).then((ok) => { if (ok) focusComposer(); }); }, onRetryInit: p.onRetryInit };

  const extras: Array<{ at: number; node: React.ReactNode }> = [];
  for (const task of tasks.filter((t) => isFinished(t) && t.endedAt !== undefined)) {
    extras.push({ at: Date.parse(task.endedAt!), node: <ClosingCard key={task.taskId} task={task} onOpenFile={p.onOpenFile} /> });
  }
  for (const task of tasks.filter((t) => t.status === 'failed' && t.endedAt !== undefined)) {
    const error = task.error ?? { code: 'turn.failed', message: task.lastError ?? '没有完成', at: task.endedAt! };
    const retry = task.taskId === p.latest?.taskId ? <Button variant="default" size="sm" disabled={p.sending} onClick={() => p.onAction(task, 'resume')}><RotateCcw size={12} />重试</Button> : undefined;
    extras.push({ at: Date.parse(task.endedAt!), node: <ErrorCard key={`err-${task.taskId}`} kicker={`「${taskLabel(task)}」没有完成`} error={error} action={retry} /> });
  }
  if (p.doc !== null && p.line !== undefined) {
    for (const decision of decisionsOn(p.doc, p.line)) {
      const at = decision.exploration === undefined ? Date.parse(decision.createdAt) : decision.exploration.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(decision.exploration.endedAt);
      extras.push({ at, node: <DecisionCard key={decision.decisionId} doc={p.doc} line={p.line} decision={decision} locked={locked} actions={planActions} /> });
    }
  }
  const anchored = new Map<number, React.ReactNode[]>();
  const trailing: React.ReactNode[] = [];
  for (const extra of extras.toSorted((a, b) => a.at - b.at)) {
    let index = -1;
    p.state.items.forEach((item, i) => { if (item.at <= extra.at) index = i; });
    if (index === -1) trailing.push(extra.node);
    else anchored.set(index, [...(anchored.get(index) ?? []), extra.node]);
  }
  const nextStep = p.latest?.report?.nextStep;
  const showNextStep = nextStep !== undefined && p.latest !== null && isFinished(p.latest) && !tasks.some((t) => t.title === nextStep.prompt.slice(0, 120));
  const choosing = p.replyTarget?.pendingInteraction === 'choice';

  const composer = (
    <>
      {resumable && (
        <div className="state-bar chrome">
          <span className="t2 sm flex-1">{resumable.status === 'paused' ? '已暂停，工作留在这里' : resumable.status === 'interrupted' ? '被打断了，可以接着做' : '还差一点，还没算完成'}</span>
          <Button variant="default" size="sm" onClick={() => p.onAction(resumable, 'resume')}><Play size={12} />继续</Button>
        </div>
      )}
      <div className="composer">
        <textarea
          ref={p.composerRef}
          rows={2}
          placeholder={choosing ? '也可以直接说你想怎么做…' : p.replyTarget ? '回复它…' : '这次想完成什么？'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running && !p.sending) send(); } }}
        />
        <div className="composer-footer chrome">
          <span className="model-chip">✳ {modelName}</span>
          <PermissionPicker mode={p.doc?.permissionMode ?? 'manual'} disabled={!p.doc || p.sending} onChange={p.onPermission} />
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
          <span className="flex-1" />
          <TabsList>
            <TabsTrigger value="chat">对话</TabsTrigger>
            <TabsTrigger value="todo">事项{todos.length > 0 && <span className="mode-badge">{todos.length}</span>}</TabsTrigger>
            <TabsTrigger value="tree">轨迹</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          {p.error && <div className="banner banner-err mb-2">{p.error}</div>}
          <div className="drawer-body">
            {p.doc && <InitCard doc={p.doc} busy={p.sending} onRetry={p.onRetryInit} onOpenFile={p.onOpenFile} />}
            {p.state.items.length > 0 && <Timeline items={p.state.items} root={p.line?.workDir ?? p.doc?.root} after={(_, i) => anchored.get(i)} />}
            {trailing}
            {showNextStep && <NextStepCard step={nextStep} busy={p.sending} onStart={() => p.onStartStep(nextStep.prompt)} />}
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} root={p.line?.workDir ?? p.doc?.root} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="drawer-foot">{composer}</div>
        </TabsContent>
        <TabsContent value="tree" className="flex min-h-0 flex-1 flex-col">
          {p.error && <div className="banner banner-err mb-2">{p.error}</div>}
          {p.doc ? <TrajectoryTree doc={p.doc} line={p.line} locked={locked} actions={treeActions} /> : <div className="t3 sm">打开中…</div>}
        </TabsContent>
        <TabsContent value="todo" className="drawer-body">
          {todos.length === 0
            ? <div className="t3 sm todo-empty">没有进行中的事项。</div>
            : TODO_GROUPS.map((group) => {
              const items = todos.filter((task) => todoGroup(task) === group.key).toReversed();
              if (items.length === 0) return null;
              return (
                <section key={group.key} className="todo-group">
                  <div className="todo-group-head">{group.title}<span className="t3"> · {items.length}</span></div>
                  {items.map((task) => (
                    <div key={task.taskId} className="todo-row">
                      <span className={`status-dot ${statusDot(task)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="todo-title">{taskLabel(task)}</div>
                        <div className="todo-meta">{statusLabel(task)}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {(task.status === 'running' || task.status === 'queued') && <Button variant="ghost" size="sm" onClick={() => p.onAction(task, 'pause')}><Square size={11} fill="currentColor" />停止</Button>}
                        {task.status === 'awaiting_user' && <Button variant="ghost" size="sm" onClick={focusComposer}><ArrowRight size={12} />{GO_LABEL[task.pendingInteraction ?? 'reply'] ?? '去回复'}</Button>}
                        {RESUMABLE.has(task.status) && <Button variant="ghost" size="sm" onClick={() => p.onAction(task, 'resume')}>{task.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</Button>}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          {p.doc && (
            <Backlog
              doc={p.doc} busy={p.sending || p.activeUserTask !== null} lockReason={p.activeUserTask !== null ? '等手上的事做完或停下后再开始' : undefined}
              onAdd={p.onAddTodo}
              onStart={(todo) => { void p.onTodoAction(todo, 'start').then((ok) => { if (ok) setTab('chat'); }); }}
              onDelete={(todo) => { void p.onTodoAction(todo, 'delete'); }}
            />
          )}
        </TabsContent>
        <AbandonDialog
          title={dropping === null ? '' : `方案 ${dropping.plan.planId} ${dropping.plan.title}`}
          open={dropping !== null}
          onCancel={() => setDropping(null)}
          onConfirm={(reason) => { if (dropping !== null) p.onAbandon(dropping.decision, dropping.plan, reason); setDropping(null); }}
        />
      </aside>
    </Tabs>
  );
}

function ClosingCard({ task, onOpenFile }: { task: ContinuoTask; onOpenFile: (path: string) => void }) {
  const deliverables = task.report?.deliverables ?? [];
  const nextStep = task.report?.nextStep;
  const unresolved = (task.report?.unresolved ?? []).filter((item) => nextStep === undefined || !coveredBy(item, nextStep));
  const ok = deliverables.filter((d) => d.exists !== false).length;
  const done = task.status === 'completed';
  return (
    <div className="deliverable fade-in">
      <div className="deliverable-head">
        {done ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <CircleAlert size={14} style={{ color: 'var(--warn)' }} />}
        <span className="font-medium">{taskLabel(task)}</span>
        <span className="t3">· {done ? '做完了' : '还差一点'}</span>
        <span className="t3">· {deliverables.length === 0 ? '没有新文件' : ok === deliverables.length ? `${deliverables.length} 份文件，已核对` : `${deliverables.length} 份文件，${deliverables.length - ok} 份不存在`}</span>
      </div>
      {deliverables.map((d) => (
        <div key={d.path} className="deliverable-row">
          {d.exists === false ? <CircleAlert size={13} style={{ color: 'var(--err)' }} /> : <Check size={13} style={{ color: 'var(--ok)' }} />}
          <span className="path" onClick={() => onOpenFile(d.path)} title="在左侧打开">{d.path}</span>
          {d.exists === false && <span className="t3 xs">文件不存在</span>}
        </div>
      ))}
      {unresolved.map((u) => <div key={u} className="deliverable-row" style={{ color: 'var(--warn)' }}><CircleAlert size={13} />还没做到：{u}</div>)}
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
