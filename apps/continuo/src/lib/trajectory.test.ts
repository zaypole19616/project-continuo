import { describe, expect, it } from 'vitest';
import type { ContinuoDoc, ContinuoTask, Decision, Trajectory } from './api';
import { buildTrunk, currentLine, isExploring, lineIsBusy, planState } from './trajectory';
import { errorTitle, spentLimit, untilText } from './errors';

const NOW = '2026-09-23T04:00:00.000Z';

function task(taskId: string, overrides: Partial<ContinuoTask> = {}): ContinuoTask {
  return { taskId, kind: 'user', title: taskId, trigger: 'user', sessionId: 's1', promptIds: [], status: 'completed', pauseRequested: false, usage: { steps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function line(trajectoryId: string, overrides: Partial<Trajectory> = {}): Trajectory {
  return { trajectoryId, label: '', sessionId: `s_${trajectoryId}`, status: 'alternative', taskIds: [], choices: [], turnCount: 0, createdAt: NOW, ...overrides };
}

const plan = (planId: string) => ({ planId, title: `plan ${planId}`, basis: 'b', risk: 'r', prompt: 'p', path: `work-log/plan-${planId}.md`, createdAt: NOW });
const decision: Decision = { decisionId: 'd1', taskId: 't3', trajectoryId: 'main', question: 'Which?', turnIndex: 4, plans: [plan('A'), plan('B'), plan('C')], createdAt: NOW };

function doc(trajectories: Trajectory[], tasks: ContinuoTask[] = ['t1', 't2', 't3', 't4', 't3b', 't5'].map((id) => task(id))): ContinuoDoc {
  return { workspaceId: 'w', root: '/p', revision: 1, openCount: 1, init: { status: 'completed' }, context: [], tasks, trajectories, decisions: [decision] };
}

describe('trajectory tree', () => {
  const main = line('main', { status: 'alternative', taskIds: ['t1', 't2', 't3', 't4'], choices: [{ decisionId: 'd1', planId: 'A', turnIndex: 5, at: NOW }] });
  const planB = line('b', { status: 'current', label: '方案B', taskIds: ['t1', 't2', 't3b'], choices: [{ decisionId: 'd1', planId: 'B', turnIndex: 5, at: NOW }], origin: { fromTrajectoryId: 'main', turnIndex: 4, decisionId: 'd1', planId: 'B' } });

  it('puts each decision right before the work it led to, on either line', () => {
    const tasks = ['t1', 't2', 't3', 't4', 't5'].map((id) => task(id)).concat(task('t3b', { branch: { decisionId: 'd1', planId: 'B', label: '方案B' } }));
    const kinds = buildTrunk(doc([main, planB], tasks), planB).map((item) => (item.kind === 'task' ? item.task.taskId : item.kind));
    expect(kinds).toEqual(['day', 't1', 't2', 'decision', 't3b']);
    const onMain = buildTrunk(doc([main, planB], tasks), main).map((item) => (item.kind === 'task' ? item.task.taskId : item.kind));
    expect(onMain).toEqual(['day', 't1', 't2', 'decision', 't3', 't4']);
  });

  it('shows the plan followed on the other line, the untaken one and the abandoned one', () => {
    const withAbandoned = { ...doc([main, planB]), decisions: [{ ...decision, plans: [plan('A'), plan('B'), { ...plan('C'), abandoned: { reason: 'late', at: NOW } }] }] };
    const [a, b, c] = withAbandoned.decisions[0]!.plans;
    expect(planState(withAbandoned, planB, withAbandoned.decisions[0]!, b!).kind).toBe('current');
    expect(planState(withAbandoned, planB, withAbandoned.decisions[0]!, a!)).toMatchObject({ kind: 'elsewhere', tasks: 2 });
    expect(planState(withAbandoned, planB, withAbandoned.decisions[0]!, c!).kind).toBe('abandoned');
    expect(planState(doc([main, planB]), planB, decision, decision.plans[2]!).kind).toBe('open');
  });

  it('hangs a line that continued after a task off that task, and the original off the child', () => {
    const child = line('child', { status: 'current', label: '从「t2」继续', taskIds: ['t1', 't2', 't5'], choices: [], origin: { fromTrajectoryId: 'main', turnIndex: 3, afterTaskId: 't2' } });
    const onChild = buildTrunk(doc([main, child]), child).find((item) => item.kind === 'task' && item.task.taskId === 't2');
    expect(onChild).toMatchObject({ stubs: [{ label: '原来的轨迹', tasks: 2 }] });
    const onMain = buildTrunk(doc([main, child]), { ...main, status: 'current' }).find((item) => item.kind === 'task' && item.task.taskId === 't2');
    expect(onMain).toMatchObject({ stubs: [{ label: '从「t2」继续', tasks: 1 }] });
  });

  it('never offers switching while the line has work in flight', () => {
    const busy = doc([{ ...main, status: 'current' }], ['t1', 't2', 't3', 't4'].map((id) => task(id, id === 't4' ? { status: 'running' } : {})));
    expect(currentLine(busy)?.trajectoryId).toBe('main');
    expect(lineIsBusy(busy, currentLine(busy))).toBe(true);
    expect(lineIsBusy(doc([{ ...main, status: 'current' }]), currentLine(doc([{ ...main, status: 'current' }])))).toBe(false);
  });
});

describe('plans written in parallel', () => {
  const exploring: Decision = { ...decision, plans: [plan('A')], exploration: { reason: 'r', angles: [{ key: 'A', title: 'a', angle: 'x', status: 'submitted', planId: 'A', steps: 2 }, { key: 'B', title: 'b', angle: 'y', status: 'running', steps: 1 }], maxSteps: 8, startedAt: NOW } };

  it('keeps a decision open for writing until every author is done', () => {
    expect(isExploring(exploring)).toBe(true);
    expect(isExploring({ ...exploring, exploration: { ...exploring.exploration!, endedAt: NOW } })).toBe(false);
    expect(isExploring(decision)).toBe(false);
  });
});

describe('failure wording', () => {
  const error = { code: 'provider.auth_error', message: "403 You've reached your 5-hour usage limit.", status: 403, at: NOW };

  it('titles a failure the way Kimi Code does, and a spent plan as what it is', () => {
    const plain = { ...error, message: '403 Forbidden' };
    expect(errorTitle(plain)).toBe('模型认证失败');
    expect(errorTitle({ ...plain, code: 'provider.rate_limit' })).toBe('模型请求被限流');
    expect(errorTitle({ ...plain, code: 'something.else' })).toBe('模型请求失败');
    expect(errorTitle(error)).toBe('已达到用量上限');
  });

  it('names the plan limit that is used up and when it resets', () => {
    const usage = { kind: 'ok', quota: { usages: { limit5h: { usedRatio: 1, resetAt: '2026-09-23T06:58:06Z' }, monthTotal: { usedRatio: 0.24, resetAt: '2026-10-21T00:00:00Z' } } } };
    expect(spentLimit(usage)).toEqual({ label: '5 小时限额', resetAt: '2026-09-23T06:58:06Z' });
    expect(spentLimit({ kind: 'ok', quota: { usages: { limit5h: { usedRatio: 0.5 } } } })).toBeUndefined();
    expect(untilText('2026-09-23T06:58:06Z', Date.parse('2026-09-23T04:27:00Z'))).toBe('2 小时 31 分钟');
    expect(untilText('2026-09-23T04:30:00Z', Date.parse('2026-09-23T04:27:00Z'))).toBe('3 分钟');
  });
});
