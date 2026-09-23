import type { ContinuoDoc, ContinuoTask, Decision, Trajectory, TrajectoryPlan } from './api';

const at = (hm: string) => new Date(`2026-09-23T${hm}:00`).toISOString();
const usage = { steps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
const OUTPUT = '3.方案/2026-09-23-三城-活动方案.md';

const INIT: ContinuoTask = {
  taskId: 'task_init', kind: 'init', title: '了解项目', trigger: 'first_open', sessionId: 's', promptIds: [], status: 'completed', pauseRequested: false, usage,
  sources: ['AGENTS.md', '1.简报/2026-09-10-上海-简报.md', '2.预算/2026-09-16-预算-v2.csv'], createdAt: at('10:02'), updatedAt: at('10:03'), endedAt: at('10:03'),
};
const SUMMARY: ContinuoTask = {
  taskId: 'task_sum', kind: 'user', title: '把三份简报汇总成一份给市场负责人的活动方案', name: '汇总三城方案', category: 'plan', trigger: 'user', sessionId: 's', promptIds: [], status: 'completed', pauseRequested: false, usage,
  report: { summary: '已汇总', deliverables: [{ path: OUTPUT, exists: true }], unresolved: [], reportedAt: at('10:21') }, createdAt: at('10:12'), updatedAt: at('10:21'), endedAt: at('10:21'),
};
const CHECK: ContinuoTask = { ...SUMMARY, taskId: 'task_check', name: '核对预算数字', title: '核对预算表和简报里的数字', report: { summary: '已核对', deliverables: [{ path: '2.预算/2026-09-23-预算-核对说明.md', exists: true }], unresolved: [], reportedAt: at('10:40') }, createdAt: at('10:32'), endedAt: at('10:40') };
const BY_CITY: ContinuoTask = { ...SUMMARY, taskId: 'task_city', name: '分章汇总', title: '按城市分三章汇总', report: { summary: '已写', deliverables: [{ path: '3.方案/2026-09-23-三城-活动方案-方案B.md', exists: true }], unresolved: [], reportedAt: at('10:52') }, branch: { decisionId: 'dec_1', planId: 'B', label: '方案B' }, createdAt: at('10:45'), endedAt: at('10:52') };

const plan = (planId: string, title: string, fit: string, basis: string, risk: string, extra: Partial<TrajectoryPlan> = {}): TrajectoryPlan => ({
  planId, title, fit, basis, risk, prompt: title, path: `work-log/plan-2026-09-23-plan-汇总三城方案-方案${planId}.md`, createdAt: at('10:14'), ...extra,
});

const DECISION: Decision = {
  decisionId: 'dec_1', taskId: 'task_sum', trajectoryId: 'trj_main', question: '汇总方案按什么结构组织？', turnIndex: 1, createdAt: at('10:14'),
  plans: [
    plan('A', '总结论 + 时间线', '负责人统管三城，想先看结论和整体节奏', 'AGENTS.md 要求汇报先给结论；三场活动在 11 月连着三个周六', '单城细节被拆开，只看某一城要翻附录'),
    plan('B', '按城市分三章', '各城市负责人分头执行，每人只看自己那章', '三份简报本来就按城市写，改动最小', '预算、物料这些共性内容会重复三遍'),
    plan('C', '按预算从高到低排', '要先把钱的事谈清楚', '负责人最关心花钱最多的城市', '读起来跳跃，不适合做执行稿', { caution: '杭州、成都的场地费在预算表里还是空的，现在排不出这个顺序' }),
  ],
  stance: { dependsOn: '负责人更在意读得快，还是各城市好分工', pick: 'A', why: 'AGENTS.md 要求汇报先给结论，看的人又是统管三城的负责人', at: at('10:14') },
};

const MAIN: Trajectory = { trajectoryId: 'trj_main', label: '', sessionId: 's', status: 'current', taskIds: ['task_sum'], choices: [], turnCount: 2, createdAt: at('10:02') };
const BY_CITY_LINE: Trajectory = { trajectoryId: 'trj_b', label: '方案B', sessionId: 's2', status: 'alternative', taskIds: ['task_city'], choices: [{ decisionId: 'dec_1', planId: 'B', turnIndex: 1, at: at('10:45') }], turnCount: 2, origin: { fromTrajectoryId: 'trj_main', turnIndex: 1, decisionId: 'dec_1', planId: 'B' }, createdAt: at('10:45') };

function sampleDoc(extra: Partial<ContinuoDoc>): ContinuoDoc {
  return {
    workspaceId: 'wd_guide', root: '/q4-plan', revision: 1, openCount: 2, init: { status: 'completed', taskId: 'task_init', startedAt: at('10:02'), endedAt: at('10:03') },
    understanding: { text: '第四季度线下活动的策划资料，有三城简报和预算表，还缺一份汇总方案。', sourceRefs: ['AGENTS.md'], updatedAt: at('10:03') },
    context: [], tasks: [INIT], trajectories: [MAIN], decisions: [DECISION], permissionMode: 'manual', ...extra,
  };
}

export const GUIDE_DECISION = sampleDoc({ tasks: [INIT, { ...SUMMARY, status: 'awaiting_user', pendingInteraction: 'choice', report: undefined, endedAt: undefined }] });

export const GUIDE_LINES = sampleDoc({
  tasks: [INIT, SUMMARY, CHECK, BY_CITY],
  trajectories: [{ ...MAIN, taskIds: ['task_sum', 'task_check'], choices: [{ decisionId: 'dec_1', planId: 'A', turnIndex: 1, at: at('10:15') }] }, BY_CITY_LINE],
});
