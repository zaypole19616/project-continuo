import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CornerDownRight, FileText, GitBranch, GitFork, RotateCcw } from 'lucide-react';
import type { ContinuoDoc, ContinuoTask, Decision, Trajectory } from '#/lib/api';
import { buildTrunk, choiceOn, isEmptyFolder, isExploring, isOpen, lastTurnOf, localDay, localTime, orderedPlans, planState, planTitle, stanceTag, taskLabel, type LineStub } from '#/lib/trajectory';
import { Button } from '#/components/ui/button';
import { Hint } from './Hint';
import { PlanDeck, type PlanActions } from './PlanDeck';

type Tier = 'mid' | 'detail';

const VIEW_KEY = 'continuo.treeView';
const VIEWS: ReadonlyArray<{ tier: Tier; label: string; hint: string }> = [
  { tier: 'mid', label: '概览', hint: '每个节点一行，看整条轨迹和分叉；点节点单独展开' },
  { tier: 'detail', label: '详情', hint: '每个节点都展开：读过什么、做了什么、结果和方案' },
];

function readView(): Tier {
  try {
    return localStorage.getItem(VIEW_KEY) === 'detail' ? 'detail' : 'mid';
  } catch {
    return 'mid';
  }
}

const SWITCH_LOCK = '等这件事做完或停下后再切换';

const STATUS: Record<string, string> = { queued: '排队中', running: '进行中', verifying: '核对产物', awaiting_user: '等你', completed: '已完成', needs_review: '还差一点', paused: '已暂停', failed: '没做完', interrupted: '被打断了' };

function statusText(task: ContinuoTask): string {
  if (task.status === 'awaiting_user') return task.pendingInteraction === 'choice' ? '等你选方案' : task.pendingInteraction === 'question' ? '等你回答' : task.pendingInteraction === 'approval' ? '等你批准' : '等你回复';
  return STATUS[task.status] ?? '';
}

function dotClass(task: ContinuoTask): string {
  if (task.status === 'running' || task.status === 'verifying' || task.status === 'queued') return 'is-running';
  if (task.status === 'awaiting_user') return 'is-waiting';
  if (task.status === 'failed' || task.status === 'interrupted') return 'is-failed';
  if (task.status === 'needs_review' || task.status === 'paused') return 'is-partial';
  return 'is-done';
}

export interface TreeActions extends PlanActions {
  onForkAfter: (task: ContinuoTask) => void;
  onRetryInit: () => void;
}

export function TrajectoryTree({ doc, line, locked, actions }: { doc: ContinuoDoc; line: Trajectory | undefined; locked: boolean; actions: TreeActions }) {
  const [tier, setTier] = useState<Tier>(readView);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, tier); } catch {} }, [tier]);

  const trunk = line === undefined ? [] : buildTrunk(doc, line);
  const toggle = (id: string) => {
    if (tier === 'detail') return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const tierFor = (id: string): Tier => (expanded.has(id) ? 'detail' : tier);
  const decisions = trunk.filter((item) => item.kind === 'decision').length;
  const tasks = trunk.filter((item) => item.kind === 'task').length;
  const lines = doc.trajectories.filter((candidate) => candidate.status !== 'abandoned').length;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, .t-card, .t-stub, textarea, input') !== null) return;
    const node = scroller.current;
    if (node === null) return;
    drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
    node.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = scroller.current;
    if (drag.current === null || node === null) return;
    node.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    node.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div className="tree">
      <div className="tree-strip">
        <span>{tasks} 个事项</span><span>·</span><span>{decisions} 个决策</span><span>·</span><span>{lines} 条轨迹</span>
        <span className="flex-1" />
        <div className="tree-views" role="tablist" aria-label="视图">
          {VIEWS.map((view) => <button key={view.tier} role="tab" aria-selected={tier === view.tier} className={tier === view.tier ? 'is-on' : ''} title={view.hint} onClick={() => { setTier(view.tier); setExpanded(new Set()); }}>{view.label}</button>)}
        </div>
      </div>
      <div ref={scroller} className="tree-scroll" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`trunk tier-${tier}`}>
          <RootNode doc={doc} tier={tierFor('root')} collapsible={tier !== 'detail'} onToggle={() => toggle('root')} locked={locked} actions={actions} />
          {trunk.map((item) => {
            if (item.kind === 'day') return <div key={`day-${item.day}`} className="t-day">{item.day}</div>;
            if (item.kind === 'task') return <TaskNode key={item.task.taskId} task={item.task} stubs={item.stubs} tier={tierFor(item.task.taskId)} collapsible={tier !== 'detail'} onToggle={() => toggle(item.task.taskId)} locked={locked} doc={doc} actions={actions} />;
            return <DecisionNode key={item.decision.decisionId} doc={doc} line={line!} decision={item.decision} tier={tierFor(item.decision.decisionId)} collapsible={tier !== 'detail'} onToggle={() => toggle(item.decision.decisionId)} locked={locked} actions={actions} />;
          })}
        </div>
      </div>
    </div>
  );
}

export function TaskNode({ doc, task, stubs, tier, collapsible, onToggle, locked, actions }: { doc: ContinuoDoc; task: ContinuoTask; stubs: LineStub[]; tier: Tier; collapsible: boolean; onToggle: () => void; locked: boolean; actions: TreeActions }) {
  const deliverables = (task.report?.deliverables ?? []).filter((item) => item.exists !== false);
  const settled = !['queued', 'running', 'verifying'].includes(task.status);
  const canFork = settled && lastTurnOf(task) !== undefined;
  const time = task.endedAt === undefined ? localTime(task.createdAt) : `${localTime(task.createdAt)}–${localTime(task.endedAt)}`;
  return (
    <div className="t-item">
      <span className={`t-dot ${dotClass(task)}`} />
      <div className={`t-card ${tier === 'detail' ? 'is-detail' : ''}`}>
        <div className={`t-head ${collapsible ? 'is-toggle' : ''}`} onClick={collapsible ? onToggle : undefined} title={collapsible ? (tier === 'detail' ? '收起' : '展开') : undefined}>
          <span className="t-name">{taskLabel(task)}</span>
          {task.branch !== undefined && <span className="t-tag is-plan" title="这条轨迹采用的方案">{planTitle(doc, task.branch.decisionId, task.branch.planId) ?? task.branch.label}</span>}
          <span className="t-time">{time}</span>
        </div>
        {tier === 'mid' && <div className="t-sub">{deliverables[0]?.path ?? statusText(task)}</div>}
        {tier === 'detail' && <TaskDetail doc={doc} task={task} />}
        {tier === 'detail' && (
          <div className="t-actions">
            <Hint title={locked ? '等这件事做完或停下后再分出新轨迹' : !canFork ? '这件事还没有完成的一轮，不能从这里接着做' : '保留现在这条，从这里另起一条继续'}>
              <Button variant="outline" size="sm" disabled={locked || !canFork} onClick={() => actions.onForkAfter(task)}><GitBranch size={12} />从这里继续</Button>
            </Hint>
            {task.logPath !== undefined && <button className="link" onClick={() => actions.onOpenFile(task.logPath!)}><FileText size={12} />工作日志</button>}
          </div>
        )}
      </div>
      {stubs.map((stub) => (
        <div key={stub.line.trajectoryId} className="t-stub">
          <CornerDownRight size={13} className="t-stub-icon" />
          <span className="t-stub-label">{stub.label}</span>
          <span className="t-stub-meta">{stub.tasks > 0 ? `${stub.tasks} 件事` : stub.label === '原来的轨迹' ? '之后没有新事项' : '还没开始'}</span>
          <Hint title={locked ? SWITCH_LOCK : '切换到这条轨迹'}><button className="icon-btn t-go" aria-label="切换到这条轨迹" disabled={locked} onClick={() => actions.onSwitch(stub.line)}><ArrowRight size={13} /></button></Hint>
        </div>
      ))}
    </div>
  );
}

const INIT_STATUS: Record<string, string> = { running: '正在了解', completed: '已了解', partial: '只看了一部分', failed: '没有完成', stopped: '被打断了' };

export function RootNode({ doc, tier, collapsible, onToggle, locked, actions }: { doc: ContinuoDoc; tier: Tier; collapsible: boolean; onToggle: () => void; locked: boolean; actions: TreeActions }) {
  const init = doc.init;
  const task = init.taskId === undefined ? undefined : doc.tasks.find((candidate) => candidate.taskId === init.taskId);
  const status = doc.understanding !== undefined && isEmptyFolder(doc) ? '空文件夹' : INIT_STATUS[init.status] ?? '还没了解';
  const dot = init.status === 'running' ? 'is-running' : init.status === 'failed' || init.status === 'stopped' ? 'is-failed' : init.status === 'partial' ? 'is-partial' : doc.understanding === undefined ? 'is-root' : 'is-done';
  const at = init.startedAt;
  const sources = task?.sources ?? [...new Set([...(doc.understanding?.sourceRefs ?? []), ...doc.context.flatMap((entry) => entry.sourceRefs)])];
  const retryable = init.status === 'failed' || init.status === 'stopped';
  return (
    <div className="t-item">
      <span className={`t-dot ${dot}`} />
      <div className={`t-card is-root ${tier === 'detail' ? 'is-detail' : ''}`}>
        <div className={`t-head ${collapsible ? 'is-toggle' : ''}`} onClick={collapsible ? onToggle : undefined} title={collapsible ? (tier === 'detail' ? '收起' : '展开') : undefined}>
          <BookOpen size={13} className="t-root-icon" />
          <span className="t-name">了解这个文件夹</span>
          <span className="t-tag is-muted">{status}</span>
          {at !== undefined && <span className="t-time">{`${localDay(at).slice(5)} ${localTime(at)}`}</span>}
        </div>
        {tier === 'mid' && <div className="t-sub">{doc.understanding?.text.split(/[。\n]/)[0] ?? status}</div>}
        {tier === 'detail' && (
          <div className="t-detail">
            <Field label="理解" primary><div className="t-line">{doc.understanding?.text ?? (retryable ? (task?.lastError ?? '没有完成') : '还没有结论')}</div></Field>
            <Field label="读过">{sources.length === 0 ? <div className="t-line">没有读文件，只看了目录结构</div> : <Paths paths={sources} />}</Field>
            {doc.context.length > 0 && (
              <Field label="要点">
                {doc.context.slice(0, 5).map((entry) => <div key={entry.id} className="t-line t-bullet">{entry.text}{entry.sourceRefs.length > 0 && <span className="init-src">{entry.sourceRefs.join('、')}</span>}</div>)}
                {doc.context.length > 5 && <div className="t-line t-more">还有 {doc.context.length - 5} 条</div>}
              </Field>
            )}
          </div>
        )}
        {tier === 'detail' && (task?.logPath !== undefined || retryable) && (
          <div className="t-actions">
            {retryable && <Hint title={locked ? '等手上的事做完或停下后再重新了解' : undefined}><Button variant="outline" size="sm" disabled={locked} onClick={actions.onRetryInit}><RotateCcw size={12} />重新了解</Button></Hint>}
            {task?.logPath !== undefined && <button className="link" onClick={() => actions.onOpenFile(task.logPath!)}><FileText size={12} />工作日志</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, primary, children }: { label: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <div className={`t-field ${primary ? 'is-primary' : ''}`}>
      <div className="t-sec">{label}</div>
      <div className="t-body">{children}</div>
    </div>
  );
}

function Paths({ paths }: { paths: readonly string[] }) {
  return <div className="t-paths">{paths.map((path) => <span key={path} className="t-path">{path}</span>)}</div>;
}

function TaskDetail({ doc, task }: { doc: ContinuoDoc; task: ContinuoTask }) {
  const rounds = task.rounds ?? [];
  const sources = task.sources ?? [];
  const deliverables = task.report?.deliverables ?? [];
  const branchDecision = task.branch === undefined ? undefined : doc.decisions.find((decision) => decision.decisionId === task.branch?.decisionId);
  return (
    <div className="t-detail">
      <Field label="任务" primary><div className="t-line t-clamp">{rounds[0]?.prompt ?? task.title}</div></Field>
      {branchDecision !== undefined && <Field label="背景"><div className="t-line">在「{branchDecision.question}」采用了「{planTitle(doc, task.branch?.decisionId, task.branch?.planId) ?? '一个方案'}」</div></Field>}
      <Field label="读过">{sources.length === 0 ? <div className="t-line">没有读项目里的文件</div> : <Paths paths={sources} />}</Field>
      <Field label="过程">
        {rounds.length === 0 ? <div className="t-line">还没有完成的一轮</div> : rounds.map((round, index) => (
          <div key={round.at + index} className="t-line t-round">
            <span className="t-at">{localTime(round.at)}</span>
            <span className="min-w-0">
              对话 {index + 1}
              {index > 0 && round.prompt !== '' && <> · {round.prompt.split('\n')[0]!.slice(0, 18)}</>}
              {round.reads.length > 0 && <span className="t-count"> · 读 {round.reads.length}</span>}
              {round.writes.length > 0 && <span className="t-count"> · 写 {round.writes.length}</span>}
            </span>
          </div>
        ))}
      </Field>
      <Field label="结果" primary>
        {deliverables.length === 0 && (task.report?.unresolved ?? []).length === 0 && <div className="t-line">{statusText(task)}</div>}
        {deliverables.map((item) => <div key={item.path} className={`t-line t-file ${item.exists === false ? 'is-miss' : ''}`}><span className="t-file-mark">{item.exists === false ? '!' : '✓'}</span><span className="t-path">{item.path}</span></div>)}
        {(task.report?.unresolved ?? []).map((item) => <div key={item} className="t-line t-warn">还没做到：{item}</div>)}
        {task.report?.nextStep !== undefined && <div className="t-line t-next">下一步：{task.report.nextStep.title}</div>}
      </Field>
    </div>
  );
}

export function DecisionNode({ doc, line, decision, tier, collapsible, onToggle, locked, actions }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; tier: Tier; collapsible: boolean; onToggle: () => void; locked: boolean; actions: TreeActions }) {
  const choice = choiceOn(line, decision.decisionId);
  const open = isOpen(line, decision);
  const current = choice?.planId === undefined ? undefined : decision.plans.find((plan) => plan.planId === choice.planId);
  const summary = open ? '等你选' : current !== undefined ? `当前：${current.title}` : `当前：自定义方向`;
  return (
    <div className="t-item is-decision">
      <span className="t-dot is-decision" />
      <div className={`t-card is-decision ${tier === 'detail' ? 'is-detail' : ''}`}>
        <div className={`t-head ${collapsible ? 'is-toggle' : ''}`} onClick={collapsible ? onToggle : undefined} title={collapsible ? (tier === 'detail' ? '收起' : '展开') : undefined}>
          <GitFork size={13} className="t-fork" />
          <span className="t-name">{decision.question}</span>
          <span className="t-tag is-muted">{isExploring(decision) ? `正在写 ${decision.exploration!.angles.length} 个方案` : `${decision.plans.length} 个方案`}</span>
        </div>
        {tier === 'mid' && <div className="t-sub">{summary}</div>}
        {tier === 'mid' && (
          <div className="t-plans">
            {orderedPlans(decision).filter((plan) => plan.planId !== choice?.planId).map((plan) => {
              const state = planState(doc, line, decision, plan);
              const tag = stanceTag(decision, plan);
              const where = state.kind === 'open' ? '备选' : state.kind === 'abandoned' ? '已放弃' : state.kind === 'elsewhere' ? '另一条轨迹' : '当前';
              return (
                <div key={plan.planId} className={`t-stub is-plan is-${state.kind}`}>
                  <CornerDownRight size={13} className="t-stub-icon" />
                  <span className="t-stub-label">{plan.title}</span>
                  <span className="t-stub-meta">{tag === undefined ? where : `${tag} · ${where}`}</span>
                  {(state.kind === 'open' || state.kind === 'elsewhere') && (
                    <Hint title={locked || isExploring(decision) ? (isExploring(decision) ? '方案都写完后再选' : SWITCH_LOCK) : state.kind === 'elsewhere' ? '切换到这条轨迹' : '采用这个方案'}>
                      <button className="icon-btn t-go" aria-label={state.kind === 'elsewhere' ? '切换到这条轨迹' : '采用这个方案'} disabled={locked || isExploring(decision)} onClick={() => (state.kind === 'elsewhere' ? actions.onSwitch(state.line) : actions.onChoose(decision, plan))}><ArrowRight size={13} /></button>
                    </Hint>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tier === 'detail' && <PlanDeck doc={doc} line={line} decision={decision} locked={locked} actions={actions} />}
      </div>
    </div>
  );
}
