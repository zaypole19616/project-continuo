import { GitFork } from 'lucide-react';
import type { ContinuoDoc, Decision, Trajectory } from '#/lib/api';
import { PlanList, type PlanActions } from './PlanList';

export function DecisionCard({ doc, line, decision, locked, actions }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; locked: boolean; actions: PlanActions }) {
  return (
    <div className="decision-card fade-in">
      <div className="decision-head"><GitFork size={14} /><span className="decision-kicker">决策点</span><span className="decision-q">{decision.question}</span></div>
      <PlanList doc={doc} line={line} decision={decision} locked={locked} actions={actions} />
    </div>
  );
}
