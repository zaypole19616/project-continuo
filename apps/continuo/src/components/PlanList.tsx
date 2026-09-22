import { ArrowRight, FileText, Plus, Shuffle } from 'lucide-react';
import type { ContinuoDoc, Decision, Trajectory, TrajectoryPlan } from '#/lib/api';
import { choiceOn, isOpen, planState, type PlanState } from '#/lib/trajectory';
import { Button } from '#/components/ui/button';

export interface PlanActions {
  onChoose: (decision: Decision, plan: TrajectoryPlan) => void;
  onSwitch: (line: Trajectory) => void;
  onAbandon: (decision: Decision, plan: TrajectoryPlan) => void;
  onExpand: (decision: Decision) => void;
  onOpenFile: (path: string) => void;
}

export function Hint({ title, children }: { title: string | undefined; children: React.ReactNode }) {
  return <span className="inline-flex" title={title}>{children}</span>;
}

const TAG: Record<PlanState['kind'], string> = { current: '当前', open: '备选', elsewhere: '另一条轨迹', abandoned: '已放弃' };

export function PlanList({ doc, line, decision, locked, actions }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; locked: boolean; actions: PlanActions }) {
  const choice = choiceOn(line, decision.decisionId);
  const open = isOpen(line, decision);
  const lockTitle = locked ? '等这件事做完或停下后再切换' : undefined;
  return (
    <div className="plan-list">
      {decision.plans.map((plan) => {
        const state = planState(doc, line, decision, plan);
        return (
          <div key={plan.planId} className={`plan-row is-${state.kind}`}>
            <span className="plan-key">{plan.planId}</span>
            <div className="plan-body">
              <div className="plan-title"><span>{plan.title}</span>{!open && <span className={`plan-tag is-${state.kind}`}>{TAG[state.kind]}</span>}</div>
              <div className="plan-field"><em>依据</em>{plan.basis}</div>
              <div className="plan-field"><em>风险</em>{plan.risk}</div>
              {state.kind === 'abandoned' && plan.abandoned?.reason !== undefined && <div className="plan-field"><em>放弃原因</em>{plan.abandoned.reason}</div>}
              {state.kind === 'elsewhere' && <div className="plan-field"><em>进展</em>{state.tasks > 0 ? `那条轨迹上做了 ${state.tasks} 件事` : '那条轨迹刚开始'}</div>}
              <div className="plan-actions">
                {state.kind === 'open' && <Hint title={lockTitle}><Button variant={open ? 'default' : 'outline'} size="sm" disabled={locked} onClick={() => actions.onChoose(decision, plan)}>走这条<ArrowRight size={12} /></Button></Hint>}
                {state.kind === 'elsewhere' && <Hint title={lockTitle}><Button variant="outline" size="sm" disabled={locked} onClick={() => actions.onSwitch(state.line)}><Shuffle size={12} />切换</Button></Hint>}
                <button className="link plan-file" onClick={() => actions.onOpenFile(plan.path)} title={plan.path}><FileText size={12} />方案文件</button>
                {(state.kind === 'open' || state.kind === 'elsewhere') && !open && <Hint title={lockTitle}><button className="link plan-drop" disabled={locked} onClick={() => actions.onAbandon(decision, plan)}>放弃</button></Hint>}
              </div>
            </div>
          </div>
        );
      })}
      {choice !== undefined && choice.planId === undefined && (
        <div className="plan-row is-current">
          <span className="plan-key">·</span>
          <div className="plan-body">
            <div className="plan-title"><span>自定义方向</span><span className="plan-tag is-current">当前</span></div>
            <div className="plan-field">{choice.text}</div>
          </div>
        </div>
      )}
      {decision.exhausted !== undefined && (
        <div className="plan-exhausted">
          <div><em>没有更多明显不同的方案</em>{decision.exhausted.reason}</div>
          <div><em>需要你定</em>{decision.exhausted.ask}</div>
        </div>
      )}
      {open && decision.exhausted === undefined && (
        <div className="plan-more">
          <Hint title={lockTitle}><Button variant="ghost" size="sm" disabled={locked} onClick={() => actions.onExpand(decision)}><Plus size={12} />再来几个</Button></Hint>
        </div>
      )}
    </div>
  );
}
