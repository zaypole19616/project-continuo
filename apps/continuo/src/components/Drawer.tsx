import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronDown, CircleAlert, Play, RotateCcw, Sparkles, Square, SquarePen } from 'lucide-react';
import { DEFAULT_MODEL, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest, type Workspace } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import { ContextPanel } from './ContextPanel';
import { WorkRecord } from './WorkRecord';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { DropdownMenu, DropdownMenuCheck, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#/components/ui/dropdown-menu';

export interface DrawerProps {
  workspace: Workspace;
  doc: ContinuoDoc | null;
  selected: ContinuoTask | null;
  sessions: ContinuoTask[];
  state: TimelineState;
  questions: QuestionRequest[];
  approvals: ApprovalRequest[];
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
  onReunderstand: () => void;
  onStartStep: (prompt: string) => void;
  onSelectTask: (task: ContinuoTask) => void;
  onNewSession: () => void;
  onError: (message: string) => void;
}

type Tab = 'chat' | 'context' | 'log';

const isAwaitingReply = (t: ContinuoTask | null) => !!t && t.status === 'awaiting_user' && t.pendingInteraction === 'reply';

function taskDot(task: ContinuoTask): string {
  if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued') return 'running';
  if (task.status === 'awaiting_user' && (task.pendingInteraction === 'question' || task.pendingInteraction === 'approval')) return 'waiting';
  if (task.status === 'failed' || task.status === 'interrupted') return 'failed';
  return '';
}

export function Drawer(p: DrawerProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastAssistant = p.state.items.at(-1);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.state.items.length, lastAssistant?.kind === 'assistant' ? lastAssistant.text.length : 0, p.questions.length, p.approvals.length, p.selected?.status]);

  const pendingContext = p.doc?.context.filter((e) => e.kind !== 'progress' && (e.status === 'candidate' || e.status === 'stale')).length ?? 0;
  const reading = p.doc?.init.status === 'running';
  const continuing = p.continueTarget !== null;
  const awaitingReply = isAwaitingReply(p.continueTarget);
  const running = p.activeUserTask !== null && p.activeUserTask.status !== 'awaiting_user';
  const hero = p.selected === null;
  const modelName = DEFAULT_MODEL.split('/').pop();
  const send = () => { p.onSend(); setDraft(''); };
  const stop = () => { if (p.activeUserTask) p.onAction(p.activeUserTask, 'pause'); };

  const composer = (
    <>
      {p.continueTarget && (p.continueTarget.status === 'paused' || p.continueTarget.status === 'interrupted' || p.continueTarget.status === 'failed' || p.continueTarget.status === 'needs_review') && (
        <div className="state-bar chrome">
          <span className="t2 sm flex-1">{p.continueTarget.status === 'paused' ? '已暂停，工作留在这里' : p.continueTarget.status === 'interrupted' ? '被打断了，可以接着做' : p.continueTarget.status === 'failed' ? '这次没做完，可以再试' : '还差一点，还没算完成'}</span>
          {p.continueTarget.status === 'needs_review' && <Button size="sm" onClick={() => p.onAction(p.continueTarget!, 'complete')}><Check size={12} />标记完成</Button>}
          <Button variant="default" size="sm" onClick={() => p.onAction(p.continueTarget!, 'resume')}>{p.continueTarget.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</Button>
        </div>
      )}
      <div className="composer">
        <textarea
          ref={p.composerRef}
          rows={2}
          placeholder={awaitingReply ? '回复它…' : continuing ? '有新的要求？直接说…' : '这次想完成什么？'}
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
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="panel-box" aria-label="对话" asChild>
      <aside>
        <div className="drawer-head">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="session-btn" title={p.selected?.title ?? '新会话'}>
                <span className="truncate">{p.selected?.title ?? '新会话'}</span><ChevronDown size={14} className="t3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <DropdownMenuItem onSelect={p.onNewSession}><SquarePen />新会话</DropdownMenuItem>
              {p.sessions.length > 0 && <DropdownMenuSeparator />}
              {p.sessions.map((t) => (
                <DropdownMenuItem key={t.taskId} onSelect={() => p.onSelectTask(t)} title={t.title}>
                  <span className="flex-1 truncate">{t.title}</span>
                  {taskDot(t) ? <span className={`status-dot ${taskDot(t)}`} /> : <DropdownMenuCheck shown={t.taskId === p.selected?.taskId} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="flex-1" />
          <TabsList>
            <TabsTrigger value="chat">对话</TabsTrigger>
            <TabsTrigger value="context">记住的事{reading ? <span className="status-dot running" /> : pendingContext > 0 && <span className="mode-badge">{pendingContext}</span>}</TabsTrigger>
            <TabsTrigger value="log">记录</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          {p.error && <div className="banner banner-err mx-3 mt-3">{p.error}</div>}
          <div className={`drawer-body ${hero ? 'is-hero' : ''}`}>
            {hero
              ? p.doc && !reading && <p className="hero-line">{memorySummary(p.doc)}<button className="link" onClick={() => setTab('context')}>{pendingContext > 0 ? '去确认' : '查看'}</button></p>
              : <Timeline items={p.state.items} emptyHint="这个会话还没有内容。" />}
            {p.selected && p.doc && (p.selected.status === 'completed' || p.selected.status === 'needs_review') && (
              <ClosingCard task={p.selected} doc={p.doc} onOpenFile={p.onOpenFile} />
            )}
            {p.selected?.report?.nextStep && p.selected.status !== 'running' && !p.doc?.tasks.some((t) => t.title === p.selected!.report!.nextStep!.prompt.slice(0, 120)) && (
              <NextStepCard step={p.selected.report.nextStep} busy={p.sending} onStart={() => p.onStartStep(p.selected!.report!.nextStep!.prompt)} />
            )}
            {p.questions.map((q) => <QuestionCard key={q.question_id} q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} />)}
            {p.approvals.map((a) => <ApprovalCard key={a.approval_id} a={a} root={p.doc?.root} onDecide={(d, scope) => p.onDecide(a, d, scope)} />)}
            <div ref={bottomRef} />
          </div>
          <div className="drawer-foot">{composer}</div>
        </TabsContent>
        <TabsContent value="context" className="drawer-body">
          {p.doc ? <ContextPanel doc={p.doc} onPatch={p.onPatchContext} onOpenFile={p.onOpenFile} onReunderstand={p.onReunderstand} /> : <div className="t3 sm">打开中…</div>}
        </TabsContent>
        <TabsContent value="log" className="drawer-body">
          {p.doc ? <WorkRecord workspaceId={p.workspace.id} revision={p.doc.revision} onError={p.onError} /> : <div className="t3 sm">打开中…</div>}
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
    </div>
  );
}

function memorySummary(doc: ContinuoDoc): string {
  const remembered = doc.context.filter((e) => e.status === 'active' && e.kind !== 'progress').length;
  const pending = doc.context.filter((e) => e.status === 'candidate').length;
  if (remembered === 0 && pending === 0) return '它已经了解了这个项目。';
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
