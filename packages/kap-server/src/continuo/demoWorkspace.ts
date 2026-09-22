import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { CONTINUO_SCHEMA_VERSION, type ContextEntry, type ContinuoTask, type ContinuoWorkspaceDoc } from '@moonshot-ai/agent-core-v2';

export const DEMO_WORKSPACE_DIRNAME = 'Continuo Demo';
export const DEMO_WORKSPACE_FOLDER = 'Northwind-Q2-复盘';

export const DEMO_FILES: Record<string, string> = {
  'README.md': `# Northwind 季度复盘项目

这个文件夹用来准备 Northwind（虚构公司）2026 年 Q2 的经营复盘材料。

- \`materials/\`：原始材料，只读。
- \`drafts/\`：写作产物放这里，文件名用 \`YYYY-MM-DD-主题.md\`。
- \`archive/\`：历史归档，不代表当前进度。

风格约定：中文，先结论后数据，每个数字标来源文件。
`,
  'archive/2025-notes.md': `2025 年的工作笔记，已归档。当时所有产物都放在根目录，现在已经不这么做了。
`,
  'drafts/2026-06-30-q1-review.md': `# 2026-06-30 Q1 复盘（旧稿）

Q1 营收 1,050 万元，毛利率 44%。此稿为 Q1 版本，仅供参考结构。
`,
  'drafts/2026-09-15-q2-review.md': `# 2026 Q2 经营复盘（初稿）

起草日期：2026-09-15。框架按 2026-09-10 经营会要求，只讲三件事：增长来源、毛利下滑原因、下季度动作。

## 一、总体结论

Q2 增长健康，但毛利被物流成本侵蚀，是本季度最需要回应的问题。

- 营收 1,240 万元，同比增长 18%（来源：materials/q2-financials.md）
- 毛利率 41%，环比下降 3 个百分点，原因是物流成本上升（来源：materials/q2-financials.md）
- 现金余额 3,860 万元（来源：materials/q2-financials.md）

## 二、增长来源

结论：增长主要靠新客获取，且高度集中在华东、依赖单一渠道伙伴"蓝桥"，集中度是风险点。

- 新客户 62 家，其中华东 35 家，占比约 56%（来源：materials/q2-financials.md）
- 华东新客户增长主要来自渠道合作伙伴"蓝桥"（来源：materials/meeting-2026-09-10.md）

## 三、毛利下滑原因

结论：毛利率环比降 3 个百分点，内部归因是物流成本上升；客户对"价格偏高"的感知也在出现。

- 毛利率 41%，环比下降 3 个百分点，直接原因是物流成本上升（来源：materials/q2-financials.md）
- 客户反馈中"价格偏高"被提到 4 次（来源：materials/customer-feedback.md）

## 四、定价

待决策：Q3 是否上调价格，等竞品调研结果（来源：materials/meeting-2026-09-10.md）。

## 五、Q3 动作

1. 物流成本：供应链负责人在 9 月底前给出方案（来源：materials/meeting-2026-09-10.md）
2. 定价：待第四节决策后补充

## 待补充

- 交付周期偏长是最高频负面反馈（9 次，来源：materials/customer-feedback.md），现有材料中没有对应改进动作和负责人。
`,
  'materials/customer-feedback.md': `# 客户反馈摘录（Q2）

- 交付周期偏长（提到 9 次）
- 售后响应快（提到 6 次）
- 价格偏高（提到 4 次）
`,
  'materials/meeting-2026-09-10.md': `# 2026-09-10 经营会纪要

- 老板要求复盘只讲三件事：增长来源、毛利下滑原因、下季度动作。
- 物流成本问题由供应链负责人在 9 月底前给出方案。
- 华东新客户增长主要来自渠道合作伙伴"蓝桥"。
- 待定：Q3 是否上调价格，等竞品调研结果。
`,
  'materials/q2-financials.md': `# Q2 财务摘要（虚构数据）

- 营收 1,240 万元，同比增长 18%（来源：财务系统导出 2026-07-05）
- 毛利率 41%，环比下降 3 个百分点，原因是物流成本上升
- 现金余额 3,860 万元
- 新客户 62 家，其中华东 35 家
`,
};

export function demoWorkspaceRoot(): string {
  return join(homedir(), DEMO_WORKSPACE_DIRNAME, DEMO_WORKSPACE_FOLDER);
}

export async function materializeDemoWorkspace(): Promise<{ root: string; created: boolean }> {
  const root = demoWorkspaceRoot();
  let created = false;
  for (const [rel, content] of Object.entries(DEMO_FILES)) {
    const abs = join(root, rel);
    if (await exists(abs)) continue;
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    created = true;
  }
  return { root, created };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

const SEED_INIT_TASK = 'task_demo_init';
const SEED_DRAFT_TASK = 'task_demo_draft';
const T0 = '2026-09-15T02:00:00.000Z';
const T1 = '2026-09-15T02:01:20.000Z';
const T2 = '2026-09-15T02:05:00.000Z';
const T3 = '2026-09-15T02:08:30.000Z';
const T4 = '2026-09-18T02:10:00.000Z';

const SEED_UNDERSTANDING = '这是 Northwind（虚构公司）2026 年 Q2 经营复盘材料的准备工作文件夹。原始材料在 materials/（只读），写作产物放 drafts/（文件名 YYYY-MM-DD-主题.md），archive/ 是历史归档不代表当前进度。写作风格：中文、先结论后数据、每个数字标注来源文件。顶层指南是 README.md。';

function entry(id: string, fields: Omit<ContextEntry, 'id' | 'scope' | 'revision' | 'updatedAt'> & { updatedAt?: string }): ContextEntry {
  return { id, scope: { type: 'workspace' }, revision: 1, updatedAt: fields.updatedAt ?? fields.createdAt, ...fields };
}

const SEED_CONTEXT: readonly ContextEntry[] = [
  entry('ctx_demo_01', { kind: 'convention', origin: 'file', status: 'active', text: '目录分工：materials/ 是原始材料，只读；drafts/ 放写作产物，文件名用 YYYY-MM-DD-主题.md；archive/ 是历史归档，不代表当前进度。', sourceRefs: ['README.md'], taskId: SEED_INIT_TASK, createdAt: T1 }),
  entry('ctx_demo_02', { kind: 'convention', origin: 'file', status: 'active', text: '写作风格约定：用中文，先结论后数据，每个数字必须标注来源文件。', sourceRefs: ['README.md'], taskId: SEED_INIT_TASK, createdAt: T1 }),
  entry('ctx_demo_03', { kind: 'material', origin: 'agent', status: 'active', text: 'materials/ 现有三份 Q2 原始材料：q2-financials.md（营收 1,240 万元同比 +18%、毛利率 41% 环比降 3pct 因物流成本、现金 3,860 万、新客户 62 家其中华东 35 家）；customer-feedback.md（交付周期偏长×9、售后响应快×6、价格偏高×4）；meeting-2026-09-10.md（经营会纪要）。', sourceRefs: ['materials/q2-financials.md', 'materials/customer-feedback.md', 'materials/meeting-2026-09-10.md'], taskId: SEED_INIT_TASK, createdAt: T1 }),
  entry('ctx_demo_04', { kind: 'decision', origin: 'agent', status: 'active', text: '2026-09-10 经营会定的复盘框架：只讲增长来源、毛利下滑原因、下季度动作。物流成本方案由供应链负责人在 9 月底前给出；华东新客户增长主要来自渠道合作伙伴"蓝桥"。', sourceRefs: ['materials/meeting-2026-09-10.md'], taskId: SEED_INIT_TASK, createdAt: T1 }),
  entry('ctx_demo_05', { kind: 'background', origin: 'agent', status: 'candidate', text: 'drafts/2026-06-30-q1-review.md 是 Q1 复盘旧稿（营收 1,050 万、毛利率 44%），仅供参考结构；archive/2025-notes.md 记录旧做法（产物全放根目录）已废弃。', sourceRefs: ['drafts/2026-06-30-q1-review.md', 'archive/2025-notes.md'], taskId: SEED_INIT_TASK, createdAt: T1 }),
  entry('ctx_demo_06', { kind: 'convention', origin: 'user', status: 'active', text: '改稿时另存为新文件，不覆盖旧稿；文件名用当天日期。', sourceRefs: ['user: "改稿另存新文件，别覆盖旧的"'], taskId: SEED_DRAFT_TASK, createdAt: T3 }),
  entry('ctx_demo_07', { kind: 'progress', origin: 'agent', status: 'active', text: 'Task "起草一份 Q2 经营复盘初稿，放到 drafts/。" completed; deliverables: drafts/2026-09-15-q2-review.md.', sourceRefs: [`task:${SEED_DRAFT_TASK}`, 'drafts/2026-09-15-q2-review.md'], taskId: SEED_DRAFT_TASK, createdAt: T3 }),
  entry('ctx_demo_08', { kind: 'decision', origin: 'user', status: 'active', text: '定价方案（2026-09-18 定）：标准版 10 月 1 日起上调 5%，企业版年度合同价不变，老客户 Q4 前按原价锁定。复盘里的定价一节按这个写。', sourceRefs: ['user: "定价按上周会议定的：标准版 10 月 1 日起上调 5%，企业版年度合同价不变，老客户 Q4 前按原价锁定"'], createdAt: T4 }),
];

const SEED_TASKS: readonly ContinuoTask[] = [
  { taskId: SEED_INIT_TASK, kind: 'init', title: '了解这个文件夹', trigger: 'demo', sessionId: '', promptIds: [], status: 'completed', pauseRequested: false, contextRevision: 1, usage: { steps: 8, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, createdAt: T0, updatedAt: T1, endedAt: T1 },
  {
    taskId: SEED_DRAFT_TASK, kind: 'user', title: '起草一份 Q2 经营复盘初稿，放到 drafts/。', trigger: 'demo', sessionId: '', promptIds: [], status: 'completed', pauseRequested: false, contextRevision: 2,
    report: { summary: '按 2026-09-10 经营会"只讲三件事"的框架起草了 Q2 经营复盘初稿，存至 drafts/2026-09-15-q2-review.md。全文中文、先结论后数据，每个数字标注来源文件；定价一节按会议纪要标为待决策。', deliverables: [{ path: 'drafts/2026-09-15-q2-review.md', note: 'Q2 经营复盘初稿：总体结论、增长来源、毛利下滑、定价、Q3 动作', exists: true }], unresolved: [], reportedAt: T3 },
    reuse: { entries: 4, questions: 0 }, usage: { steps: 12, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, createdAt: T2, updatedAt: T3, endedAt: T3,
  },
];

export function seedDemoDoc(workspaceId: string, root: string): ContinuoWorkspaceDoc {
  return {
    schemaVersion: CONTINUO_SCHEMA_VERSION,
    workspaceId,
    root,
    revision: 1,
    createdAt: T0,
    updatedAt: T4,
    openCount: 1,
    init: { status: 'completed', taskId: SEED_INIT_TASK, startedAt: T0, endedAt: T1 },
    understanding: { text: SEED_UNDERSTANDING, sourceRefs: ['README.md', 'materials/q2-financials.md', 'materials/customer-feedback.md', 'materials/meeting-2026-09-10.md', 'drafts/2026-06-30-q1-review.md', 'archive/2025-notes.md'], updatedAt: T1 },
    context: SEED_CONTEXT,
    tasks: SEED_TASKS,
    activity: [
      { at: T0, kind: 'system', text: 'Workspace opened for the first time' },
      { at: T1, taskId: SEED_INIT_TASK, kind: 'task', text: 'Understanding recorded from README.md and materials/' },
      { at: T3, taskId: SEED_DRAFT_TASK, kind: 'task', text: 'Task completed: drafts/2026-09-15-q2-review.md' },
      { at: T4, kind: 'context', text: 'Recorded decision: 定价方案（2026-09-18 定）' },
      { at: T4, kind: 'system', text: 'Demo history bundled with the demo folder; the sessions behind these tasks were not kept' },
    ],
  };
}
