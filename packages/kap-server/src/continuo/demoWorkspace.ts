import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';


export const DEMO_WORKSPACE_DIRNAME = 'Continuo Demo';
export const DEMO_WORKSPACE_FOLDER = 'Northwind-Q2-复盘';

const DEMO_FILES: Record<string, string> = {
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
