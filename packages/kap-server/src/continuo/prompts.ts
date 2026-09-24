import { taskName, type ContinuoTask, type ExplorationAngle, type TrajectoryPlan, type WorkspaceScan } from '@moonshot-ai/agent-core-v2';

import { renderScanForPrompt } from './scan';
import { failureText } from './taskState';

export interface MainTurn {
  readonly text: string;
  readonly round: string;
}

export function mainTurnUser(text: string): MainTurn {
  return { text, round: text };
}

export function mainTurnResume(task: ContinuoTask): MainTurn {
  const unresolved = task.report?.unresolved ?? [];
  const failure = failureText(task);
  const reason = task.status === 'needs_review'
    ? `上次核对时还差一点${unresolved.length > 0 ? `：${unresolved.join('；')}` : ''}。`
    : task.status === 'failed'
      ? `上次没做完${failure === undefined ? '' : `（${failure.slice(0, 120)}）`}。`
      : '上次停在了半路。';
  return { text: `继续「${taskName(task)}」。${reason}先看看项目里已经有什么，别重做做完的部分，把剩下的做完。`, round: '继续这件事' };
}

export function mainTurnAdoptPlan(plan: TrajectoryPlan): MainTurn {
  return { text: `按「${plan.title}」继续：${plan.prompt}`, round: `采用「${plan.title}」` };
}

export const MAIN_TURN_MORE_PLANS: MainTurn = {
  text: '再给几个方案，只要和已有方案思路明显不同的。如果已经没有真正不同的方向，就告诉我为什么，以及需要我来定的那个问题。',
  round: '更多方案',
};

export function mainTurnComparePlans(plans: readonly TrajectoryPlan[]): MainTurn {
  const titles = plans.map((plan) => `「${plan.title}」`).join('、');
  return {
    text: `分头写的方案都交上来了：${titles}。读完后把选哪个取决于什么记到决策卡上；如果材料里有事实能定下来，也记上你建议哪个、为什么。先不要开始任何一个。`,
    round: '比较方案',
  };
}

export function hiddenTurnFirstRead(scan: WorkspaceScan, root: string): string {
  return [
    'A user just opened this folder in Continuo. Understand how it is organized and record it with WorkspaceContext, following your instructions.',
    'Budget: read at most 8 files, in about 8 steps.',
    '',
    renderScanForPrompt(scan, root),
  ].join('\n');
}

export function hiddenTurnWritePlan(angle: ExplorationAngle): string {
  return `Write plan ${angle.key}: ${angle.title}. ${angle.angle}`;
}
