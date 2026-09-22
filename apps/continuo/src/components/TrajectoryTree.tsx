import { useEffect, useRef, useState } from 'react';
import { CornerDownRight, FileText, GitBranch, GitFork, Maximize2, Minus, Plus, Shuffle } from 'lucide-react';
import type { ContinuoDoc, ContinuoTask, Decision, Trajectory } from '#/lib/api';
import { buildTrunk, choiceOn, isOpen, lastTurnOf, localTime, planState, taskLabel, type LineStub } from '#/lib/trajectory';
import { Button } from '#/components/ui/button';
import { Hint, PlanList, type PlanActions } from './PlanList';

type Tier = 'compact' | 'mid' | 'detail';

const ZOOM_KEY = 'continuo.treeZoom';
const MIN = 0.45;
const MAX = 1.4;
const OVERVIEW = 0.5;

function tierOf(zoom: number): Tier {
  return zoom < 0.62 ? 'compact' : zoom < 1 ? 'mid' : 'detail';
}

function readZoom(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_KEY));
    return stored >= MIN && stored <= MAX ? stored : 0.8;
  } catch {
    return 0.8;
  }
}

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
}

export function TrajectoryTree({ doc, line, locked, actions }: { doc: ContinuoDoc; line: Trajectory | undefined; locked: boolean; actions: TreeActions }) {
  const [zoom, setZoom] = useState(readZoom);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => { try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch {} }, [zoom]);
  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => clamp(current * Math.exp(-event.deltaY * 0.004)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  if (line === undefined) return <div className="t3 sm tree-empty">还没有事项。</div>;
  const trunk = buildTrunk(doc, line);
  const tier = tierOf(zoom);
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
      <div className="tree-strip"><span>{tasks} 个事项</span><span>·</span><span>{decisions} 个决策点</span><span>·</span><span>{lines} 条轨迹</span></div>
      <div ref={scroller} className="tree-scroll" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`trunk tier-${tier}`} style={{ zoom: Math.max(zoom, 0.8) }}>
          {trunk.map((item) => {
            if (item.kind === 'day') return <div key={`day-${item.day}`} className="t-day">{item.day}</div>;
            if (item.kind === 'task') return <TaskNode key={item.task.taskId} task={item.task} stubs={item.stubs} tier={tierFor(item.task.taskId)} collapsible={tier !== 'detail'} onToggle={() => toggle(item.task.taskId)} locked={locked} doc={doc} actions={actions} />;
            return <DecisionNode key={item.decision.decisionId} doc={doc} line={line} decision={item.decision} tier={tierFor(item.decision.decisionId)} collapsible={tier !== 'detail'} onToggle={() => toggle(item.decision.decisionId)} locked={locked} actions={actions} />;
          })}
        </div>
      </div>
      <div className="tree-zoom">
        <span className="tree-scale">{Math.round(zoom * 100)}%</span>
        <button title="放大" onClick={() => setZoom((current) => clamp(current * 1.25))}><Plus size={14} /></button>
        <button title="缩小" onClick={() => setZoom((current) => clamp(current / 1.25))}><Minus size={14} /></button>
        <button title="全景" onClick={() => { setZoom(OVERVIEW); scroller.current?.scrollTo({ top: 0, left: 0 }); }}><Maximize2 size={13} /></button>
      </div>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value));
}

function TaskNode({ doc, task, stubs, tier, collapsible, onToggle, locked, actions }: { doc: ContinuoDoc; task: ContinuoTask; stubs: LineStub[]; tier: Tier; collapsible: boolean; onToggle: () => void; locked: boolean; actions: TreeActions }) {
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
          {task.branch !== undefined && <span className="t-tag">{task.branch.label}</span>}
          {tier !== 'compact' && task.category !== undefined && <span className="t-tag is-muted">{task.category}</span>}
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
          {tier !== 'compact' && <span className="t-stub-meta">{stub.tasks > 0 ? `${stub.tasks} 件事` : stub.label === '原来的轨迹' ? '之后没有新事项' : '还没开始'}</span>}
          {tier !== 'compact' && <Hint title={locked ? '等这件事做完或停下后再切换' : undefined}><Button variant="ghost" size="sm" disabled={locked} onClick={() => actions.onSwitch(stub.line)}><Shuffle size={12} />切换</Button></Hint>}
        </div>
      ))}
    </div>
  );
}

function TaskDetail({ doc, task }: { doc: ContinuoDoc; task: ContinuoTask }) {
  const rounds = task.rounds ?? [];
  const sources = task.sources ?? [];
  const deliverables = task.report?.deliverables ?? [];
  const branchDecision = task.branch === undefined ? undefined : doc.decisions.find((decision) => decision.decisionId === task.branch?.decisionId);
  return (
    <div className="t-detail">
      <section>
        <div className="t-sec">背景</div>
        {branchDecision !== undefined && <div className="t-line">在「{branchDecision.question}」选了{task.branch?.label}</div>}
        <div className="t-line">{sources.length === 0 ? '没有读项目里的文件' : `读过 ${sources.join('、')}`}</div>
      </section>
      <section>
        <div className="t-sec">任务</div>
        <div className="t-line t-clamp">{rounds[0]?.prompt ?? task.title}</div>
      </section>
      <section>
        <div className="t-sec">过程</div>
        {rounds.length === 0 ? <div className="t-line">还没有完成的一轮</div> : rounds.map((round, index) => (
          <div key={round.at + index} className="t-line">
            <span className="t-mono">{localTime(round.at)}</span> 对话 {index + 1}
            {index > 0 && round.prompt !== '' && <> · {round.prompt.split('\n')[0]!.slice(0, 18)}</>}
            {round.reads.length > 0 && <> · 读 {round.reads.length}</>}
            {round.writes.length > 0 && <> · 写 {round.writes.length}</>}
          </div>
        ))}
      </section>
      <section>
        <div className="t-sec">结果</div>
        {deliverables.length === 0 && (task.report?.unresolved ?? []).length === 0 && <div className="t-line">{statusText(task)}</div>}
        {deliverables.map((item) => <div key={item.path} className="t-line"><span className={item.exists === false ? 't-miss' : 't-ok'}>{item.exists === false ? '!' : '✓'}</span> <span className="t-mono">{item.path}</span></div>)}
        {(task.report?.unresolved ?? []).map((item) => <div key={item} className="t-line t-warn">还没做到：{item}</div>)}
        {task.report?.nextStep !== undefined && <div className="t-line">下一步建议：{task.report.nextStep.title}</div>}
      </section>
    </div>
  );
}

function DecisionNode({ doc, line, decision, tier, collapsible, onToggle, locked, actions }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; tier: Tier; collapsible: boolean; onToggle: () => void; locked: boolean; actions: TreeActions }) {
  const choice = choiceOn(line, decision.decisionId);
  const open = isOpen(line, decision);
  const current = choice?.planId === undefined ? undefined : decision.plans.find((plan) => plan.planId === choice.planId);
  const summary = open ? '等你选' : current !== undefined ? `当前 ${current.planId} ${current.title}` : '自定义方向';
  return (
    <div className="t-item is-decision">
      <span className="t-dot is-decision" />
      <div className={`t-card is-decision ${tier === 'detail' ? 'is-detail' : ''}`}>
        <div className={`t-head ${collapsible ? 'is-toggle' : ''}`} onClick={collapsible ? onToggle : undefined} title={collapsible ? (tier === 'detail' ? '收起' : '展开') : undefined}>
          <GitFork size={13} className="t-fork" />
          <span className="t-name">{decision.question}</span>
          <span className="t-tag is-muted">{decision.plans.length} 个方案</span>
        </div>
        {tier === 'mid' && <div className="t-sub">{summary}</div>}
        {tier === 'compact' && decision.plans.some((plan) => planState(doc, line, decision, plan).kind === 'elsewhere') && (
          <div className="t-plans">
            {decision.plans.filter((plan) => planState(doc, line, decision, plan).kind === 'elsewhere').map((plan) => (
              <div key={plan.planId} className="t-stub is-plan is-elsewhere">
                <CornerDownRight size={13} className="t-stub-icon" />
                <span className="t-stub-label">{plan.planId} {plan.title}</span>
              </div>
            ))}
          </div>
        )}
        {tier === 'mid' && (
          <div className="t-plans">
            {decision.plans.filter((plan) => plan.planId !== choice?.planId).map((plan) => {
              const state = planState(doc, line, decision, plan);
              return (
                <div key={plan.planId} className={`t-stub is-plan is-${state.kind}`}>
                  <CornerDownRight size={13} className="t-stub-icon" />
                  <span className="t-stub-label">{plan.planId} {plan.title}</span>
                  <span className="t-stub-meta">{state.kind === 'open' ? '备选' : state.kind === 'abandoned' ? '已放弃' : state.kind === 'elsewhere' ? '另一条轨迹' : '当前'}</span>
                  {state.kind === 'open' && <Hint title={locked ? '等这件事做完或停下后再切换' : undefined}><Button variant="ghost" size="sm" disabled={locked} onClick={() => actions.onChoose(decision, plan)}>走这条</Button></Hint>}
                  {state.kind === 'elsewhere' && <Hint title={locked ? '等这件事做完或停下后再切换' : undefined}><Button variant="ghost" size="sm" disabled={locked} onClick={() => actions.onSwitch(state.line)}><Shuffle size={12} />切换</Button></Hint>}
                </div>
              );
            })}
          </div>
        )}
        {tier === 'detail' && <PlanList doc={doc} line={line} decision={decision} locked={locked} actions={actions} />}
      </div>
    </div>
  );
}
