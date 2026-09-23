import { GitFork } from 'lucide-react';
import type { ContinuoDoc, Decision, Trajectory } from '#/lib/api';
import { PlanDeck, type PlanActions } from './PlanDeck';

export function DecisionCard({ doc, line, decision, locked, actions }: { doc: ContinuoDoc; line: Trajectory; decision: Decision; locked: boolean; actions: PlanActions }) {
  return (
    <div className="decision-card fade-in">
      <PlanDeck doc={doc} line={line} decision={decision} locked={locked} actions={actions} head={<div className="decision-head"><GitFork size={14} /><span className="decision-kicker">决策点</span><span className="decision-q">{decision.question}</span></div>} />
    </div>
  );
}
