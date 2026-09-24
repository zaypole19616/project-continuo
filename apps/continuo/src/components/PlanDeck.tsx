import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FileText, Loader2, PenLine, Scale, Sparkles, ThumbsUp, TriangleAlert } from 'lucide-react';
import type { ContinuoDoc, Decision, Trajectory, TrajectoryPlan } from '#/lib/api';
import { choiceOn, hingeText, isExploring, isOpen, orderedPlans, planState } from '#/lib/trajectory';
import { Hint } from './Hint';

export interface PlanActions {
  onChoose: (decision: Decision, plan: TrajectoryPlan) => void;
  onSwitch: (line: Trajectory) => void;
  onAbandon: (decision: Decision, plan: TrajectoryPlan) => void;
  onExpand: (decision: Decision) => void;
  onCustom: (decision: Decision) => void;
  onOpenFile: (path: string) => void;
}

const STATE_TAG: Record<string, string> = { current: '当前', elsewhere: '另一条轨迹', abandoned: '已放弃' };

export function PlanDeck({ doc, line, decision, locked, actions, head }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; locked: boolean; actions: PlanActions; head?: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const choice = choiceOn(line, decision.decisionId);
  const open = isOpen(line, decision);
  const writing = isExploring(decision);
  const plans = orderedPlans(decision);
  const stance = decision.stance;
  const pending = (decision.exploration?.angles ?? []).filter((angle) => angle.status === 'queued' || angle.status === 'running');
  const skipped = writing ? [] : (decision.exploration?.angles ?? []).filter((angle) => angle.status === 'withdrawn' || angle.status === 'failed');
  const custom = choice !== undefined && choice.planId === undefined ? choice.text : undefined;
  const lockTitle = writing ? '方案都写完后再选' : locked ? '等这件事做完或停下后再切换' : undefined;
  const total = (custom === undefined ? 0 : 1) + plans.length + pending.length + (open ? 1 : 0);
  const currentIndex = custom !== undefined ? 0 : plans.findIndex((plan) => planState(doc, line, decision, plan).kind === 'current');

  const cardAt = (index: number) => scroller.current?.children[index] as HTMLElement | undefined;
  const goTo = (index: number, smooth = true) => {
    const node = scroller.current;
    const card = cardAt(Math.max(0, Math.min(total - 1, index)));
    if (node === null || card === undefined) return;
    node.scrollTo({ left: card.offsetLeft - 12, behavior: smooth ? 'smooth' : 'auto' });
  };
  const settled = useRef(false);
  useEffect(() => {
    if (currentIndex >= 0) goTo(currentIndex, settled.current);
    settled.current = true;
  }, [currentIndex, custom]);
  const onScroll = () => {
    const node = scroller.current;
    const first = cardAt(0);
    const second = cardAt(1);
    if (node === null || first === undefined) return;
    const stride = second === undefined ? first.offsetWidth : second.offsetLeft - first.offsetLeft;
    const atEnd = node.scrollLeft >= node.scrollWidth - node.clientWidth - 2;
    setActive(atEnd ? total - 1 : Math.max(0, Math.min(total - 1, Math.round(node.scrollLeft / stride))));
  };

  return (
    <div className="deck">
      <div className="deck-bar">
        {head}
        <span className="flex-1" />
        <span className="deck-count">{Math.min(active + 1, total)} / {total}</span>
        <button className="icon-btn" title="上一个" aria-label="上一个" disabled={active === 0} onClick={() => goTo(active - 1)}><ChevronLeft size={15} /></button>
        <button className="icon-btn" title="下一个" aria-label="下一个" disabled={active >= total - 1} onClick={() => goTo(active + 1)}><ChevronRight size={15} /></button>
      </div>
      {stance?.dependsOn !== undefined && <div className="deck-depends"><Scale size={13} /><span><em>取决于</em>{hingeText(stance.dependsOn)}</span></div>}
      <div ref={scroller} className="deck-track" onScroll={onScroll}>
        {custom !== undefined && (
          <article className={`deck-card is-current ${active === 0 ? 'is-active' : ''}`}>
            <div className="deck-tags"><span className="deck-state is-current">当前</span></div>
            <h4 className="deck-title">自定义方向</h4>
            <div className="deck-text">{custom}</div>
          </article>
        )}
        {plans.map((plan, index) => {
          const state = planState(doc, line, decision, plan);
          const picked = stance?.pick === plan.planId;
          const position = index + (custom === undefined ? 0 : 1);
          const canGo = state.kind === 'open' || state.kind === 'elsewhere';
          return (
            <article key={plan.planId} className={`deck-card is-${state.kind} ${active === position ? 'is-active' : ''}`}>
              <div className="deck-tags">
                {picked && <span className="deck-mark is-pick">建议</span>}
                {!picked && plan.caution !== undefined && <span className="deck-mark is-caution">不建议</span>}
                {state.kind !== 'open' && <span className={`deck-state is-${state.kind}`}>{STATE_TAG[state.kind]}</span>}
              </div>
              <h4 className="deck-title">{plan.title}</h4>
              {plan.fit !== undefined && <p className="deck-fit">{plan.fit}</p>}
              {picked && stance?.why !== undefined && <div className="deck-callout is-why"><div className="deck-callout-head"><ThumbsUp size={12} />为什么建议</div><p>{stance.why}</p></div>}
              {!picked && plan.caution !== undefined && <div className="deck-callout is-caution"><div className="deck-callout-head"><TriangleAlert size={12} />不建议</div><p>{plan.caution}</p></div>}
              <dl className="deck-fields">
                <dt>依据</dt><dd>{plan.basis}</dd>
                <dt>风险</dt><dd>{plan.risk}</dd>
                {state.kind === 'abandoned' && plan.abandoned?.reason !== undefined && <><dt>放弃</dt><dd>{plan.abandoned.reason}</dd></>}
                {state.kind === 'elsewhere' && <><dt>进展</dt><dd>{state.tasks > 0 ? `那条轨迹上做了 ${state.tasks} 件事` : '那条轨迹刚开始'}</dd></>}
              </dl>
              <div className="deck-foot">
                <button className="link deck-link" onClick={() => actions.onOpenFile(plan.path)} title={plan.path}><FileText size={12} />方案文件</button>
                {canGo && !open && <Hint title={lockTitle}><button className="link deck-link" disabled={locked} onClick={() => actions.onAbandon(decision, plan)}>放弃</button></Hint>}
                <span className="flex-1" />
                {canGo && (
                  <Hint title={lockTitle ?? (state.kind === 'elsewhere' ? '切换到这条轨迹' : '采用这个方案')}>
                    <button className="deck-go" aria-label={state.kind === 'elsewhere' ? '切换到这条轨迹' : '采用这个方案'} disabled={locked || writing} onClick={() => (state.kind === 'elsewhere' ? actions.onSwitch(state.line) : actions.onChoose(decision, plan))}><ArrowRight size={16} /></button>
                  </Hint>
                )}
              </div>
            </article>
          );
        })}
        {pending.map((angle, index) => (
          <article key={angle.key} className={`deck-card is-writing ${active === plans.length + index ? 'is-active' : ''}`}>
            <div className="deck-tags"><span className="deck-state is-writing"><Loader2 size={11} className="spin" />{angle.status === 'queued' ? '等待开始' : '正在写'}</span></div>
            <h4 className="deck-title">{angle.title}</h4>
            <div className="deck-text">{angle.angle}</div>
          </article>
        ))}
        {open && (
          <article className={`deck-card is-tail ${active === total - 1 ? 'is-active' : ''}`}>
            <h4 className="deck-title">其他方向</h4>
            {decision.exhausted === undefined
              ? (
                <span className="deck-hint" title={lockTitle}>
                  <button className="deck-option" disabled={locked || writing} onClick={() => actions.onExpand(decision)}>
                    <Sparkles size={15} /><span className="min-w-0 flex-1"><span className="deck-option-title">生成更多方案</span><span className="deck-option-sub">只要和现有方案思路明显不同的</span></span>
                  </button>
                </span>
              )
              : (
                <div className="deck-exhausted">
                  <div><em>没有更多明显不同的方案</em>{decision.exhausted.reason}</div>
                  <div><em>需要你定</em>{decision.exhausted.ask}</div>
                </div>
              )}
            <span className="deck-hint" title={lockTitle}>
              <button className="deck-option" disabled={locked || writing} onClick={() => actions.onCustom(decision)}>
                <PenLine size={15} /><span className="min-w-0 flex-1"><span className="deck-option-title">自定义方向</span><span className="deck-option-sub">在下方输入框写下你想要的方向</span></span>
              </button>
            </span>
            {skipped.length > 0 && (
              <div className="deck-skipped">
                {skipped.map((angle) => <div key={angle.key}><em>{angle.title}</em>{angle.status === 'withdrawn' ? `已合并，${angle.note ?? ''}` : `没写完，${angle.note ?? ''}`}</div>)}
              </div>
            )}
          </article>
        )}
      </div>
      {total > 1 && (
        <div className="deck-dots">
          {Array.from({ length: total }, (_, index) => <button key={index} className={index === active ? 'is-on' : ''} aria-label={`第 ${index + 1} 张`} onClick={() => goTo(index)} />)}
        </div>
      )}
    </div>
  );
}
