import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  WORK_LOG_DIR,
  choiceOn,
  lineRoot,
  localDay,
  localTime,
  logSlug,
  planStatusOn,
  rootOfTask,
  taskCategory,
  taskName,
  trajectoryOfSession,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type Decision,
  type IContinuoStore,
  type TaskStatus,
  type TrajectoryPlan,
} from '@moonshot-ai/agent-core-v2';

import { patchTask, requireDoc } from './doc';
import { TASK_STATUS_LABEL, failureText } from './taskState';

const DONE = new Set<TaskStatus>(['completed', 'needs_review']);

export async function writePlanFiles(store: IContinuoStore, workspaceId: string, taskId: string): Promise<void> {
  const doc = await requireDoc(store, workspaceId);
  const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) return;
  for (const decision of doc.decisions.filter((candidate) => candidate.taskId === taskId)) {
    const holders = doc.trajectories.filter((line) => line.status !== 'abandoned' && (line.trajectoryId === decision.trajectoryId || line.taskIds.includes(taskId) || choiceOn(line, decision.decisionId) !== undefined));
    for (const root of new Set(holders.map((line) => lineRoot(doc, line)))) {
      try {
        await mkdir(resolve(root, WORK_LOG_DIR), { recursive: true });
        for (const plan of decision.plans) await writeFile(resolve(root, plan.path), renderPlan(doc, task, decision, plan), 'utf8');
      } catch {
        continue;
      }
    }
  }
}

export async function writeWorkLog(store: IContinuoStore, workspaceId: string, taskId: string): Promise<void> {
  const doc = await requireDoc(store, workspaceId);
  const task = doc.tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) return;
  const root = rootOfTask(doc, task);
  const dir = resolve(root, WORK_LOG_DIR);
  try {
    await mkdir(dir, { recursive: true });
    const earlierInit = task.kind === 'init' && task.logPath === undefined ? doc.tasks.findLast((candidate) => candidate.kind === 'init' && candidate.logPath !== undefined)?.logPath : undefined;
    const path = earlierInit ?? await logPathFor(dir, task);
    if (task.logPath !== undefined && task.logPath !== path) {
      await rename(resolve(root, task.logPath), resolve(root, path)).catch(() => undefined);
    }
    await writeFile(resolve(root, path), renderWorkLog(doc, task), 'utf8');
    if (task.logPath !== path) await patchTask(store, workspaceId, taskId, (current) => ({ ...current, logPath: path }));
  } catch {
    return;
  }
}

export async function logPathFor(dir: string, task: ContinuoTask): Promise<string> {
  const day = localDay(task.endedAt ?? task.createdAt);
  const base = ['work-log', day, taskCategory(task), logSlug(taskName(task)), task.branch?.label].filter((part) => part !== undefined && part !== '').join('-');
  if (task.logPath?.startsWith(`${WORK_LOG_DIR}/${base}`) === true) return task.logPath;
  const taken = new Set(await readdir(dir).catch(() => []));
  let name = `${base}.md`;
  for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}.md`;
  return `${WORK_LOG_DIR}/${name}`;
}

function stamp(iso: string | undefined): string {
  return iso === undefined ? '' : `${localDay(iso)} ${localTime(iso)}`;
}

function oneLine(text: string, max: number): string {
  const line = text.split('\n').map((part) => part.trim()).filter((part) => part !== '').join(' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function decisionsOfTask(doc: ContinuoWorkspaceDoc, task: ContinuoTask): Decision[] {
  return doc.decisions.filter((decision) => decision.taskId === task.taskId);
}

function planStatusText(doc: ContinuoWorkspaceDoc, task: ContinuoTask, decision: Decision, plan: TrajectoryPlan): string {
  if (plan.abandoned !== undefined) return plan.abandoned.reason === undefined ? '已放弃' : `已放弃：${plan.abandoned.reason}`;
  const line = trajectoryOfSession(doc, task.sessionId);
  if (line === undefined) return '备选';
  const status = planStatusOn(doc, line, decision, plan);
  if (status.kind === 'current') return '本事项采用';
  if (status.kind === 'elsewhere') return '在另一条轨迹上执行';
  return '备选';
}

function planFileStatus(doc: ContinuoWorkspaceDoc, decision: Decision, plan: TrajectoryPlan): string {
  if (plan.abandoned !== undefined) return '已放弃';
  const followed = doc.trajectories.filter((line) => line.status !== 'abandoned' && choiceOn(line, decision.decisionId)?.planId === plan.planId).length;
  return followed === 0 ? '备选' : '已执行';
}

function renderPlan(doc: ContinuoWorkspaceDoc, task: ContinuoTask, decision: Decision, plan: TrajectoryPlan): string {
  const category = taskCategory(task);
  const lines = [
    `# 方案 ${plan.planId}：${plan.title}`,
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 决策 | ${decision.question} |`,
    `| 事项 | ${taskName(task)}${category === undefined ? '' : `（${category}）`} |`,
    `| 提出时间 | ${stamp(plan.createdAt)} |`,
    `| 状态 | ${planFileStatus(doc, decision, plan)} |`,
    '',
    ...(plan.fit === undefined ? [] : ['## 适合', '', plan.fit.trim(), '']),
    ...(decision.stance?.pick === plan.planId && decision.stance.why !== undefined ? ['## 为什么建议', '', decision.stance.why.trim(), ''] : []),
    ...(plan.caution === undefined ? [] : ['## 不建议', '', plan.caution.trim(), '']),
    '## 依据',
    '',
    plan.basis.trim(),
    '',
    '## 风险',
    '',
    plan.risk.trim(),
  ];
  if (plan.detail !== undefined && plan.detail.trim() !== '') lines.push('', '## 详情', '', plan.detail.trim());
  lines.push('', '## 选这个方案时发送', '', `> ${oneLine(plan.prompt, 800)}`);
  if (plan.abandoned?.reason !== undefined) lines.push('', '## 放弃原因', '', plan.abandoned.reason);
  return `${lines.join('\n')}\n`;
}

function renderWorkLog(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string {
  const name = taskName(task);
  const category = taskCategory(task);
  const lines = [`# 工作日志：${name}${category === undefined ? '' : `（${category}）`}`, ''];
  if (task.kind === 'init') {
    lines.push(...renderInitLog(doc, task));
    return `${lines.join('\n')}\n`;
  }
  lines.push(...renderStar(doc, task), '', '---', '', `## Session: ${stamp(task.createdAt)} - ${name}`, '', ...renderSession(doc, task));
  return `${lines.join('\n')}\n`;
}

function renderInitLog(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const lines = ['| 字段 | 值 |', '|------|-----|', `| 开始时间 | ${stamp(task.createdAt)} |`];
  if (task.endedAt !== undefined) lines.push(`| 结束时间 | ${stamp(task.endedAt)} |`);
  lines.push(`| 状态 | ${TASK_STATUS_LABEL[task.status]} |`, `| 项目目录 | ${doc.root} |`);
  if (doc.understanding !== undefined) lines.push('', '## 这个项目是什么', '', doc.understanding.text.trim());
  if (doc.context.length > 0) {
    lines.push('', '## 项目要点', '');
    for (const entry of doc.context) lines.push(`- ${entry.text}${entry.sourceRefs.length > 0 ? `（来源：${entry.sourceRefs.join('、')}）` : ''}`);
  }
  return lines;
}

function renderStar(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const rounds = task.rounds ?? [];
  const points = doc.context.slice(0, 3).map((entry) => entry.text.trim().replace(/[。.；;]$/, '')).join('；');
  const situation = [
    `${stamp(task.createdAt)}，在项目 ${doc.root.split('/').filter(Boolean).pop() ?? doc.root}${task.category === undefined ? '' : `，分类 ${task.category}`}。`,
    doc.understanding === undefined ? '' : oneLine(doc.understanding.text, 200),
    points === '' ? '' : `项目约定：${points}`,
  ].filter((part) => part !== '').join(' ');
  const pending = !DONE.has(task.status);
  const reads = [...new Set(rounds.flatMap((round) => round.reads))];
  const writes = [...new Set(rounds.flatMap((round) => round.writes))];
  const action = pending
    ? '⏳ 待阶段完成'
    : [
        `共 ${rounds.length} 轮。`,
        reads.length === 0 ? '' : `读了 ${reads.join('、')}。`,
        writes.length === 0 ? '' : `写出 ${writes.join('、')}。`,
        (task.supplements ?? []).length === 0 ? '' : `中途补充：${(task.supplements ?? []).map((item) => oneLine(item, 60)).join('；')}。`,
        ...decisionsOfTask(doc, task).map((decision) => `在「${decision.question}」给出 ${decision.plans.length} 个方案：${decision.plans.map((plan) => `${plan.planId} ${plan.title}（${planStatusText(doc, task, decision, plan)}）`).join('、')}。`),
      ].filter((part) => part !== '').join('');
  const deliverables = task.report?.deliverables ?? [];
  const missing = deliverables.filter((item) => item.exists === false).length;
  const result = pending
    ? '⏳ 待阶段完成'
    : [
        task.report === undefined ? '' : oneLine(task.report.summary, 300),
        deliverables.length === 0 ? '' : `产物 ${deliverables.length} 份，${missing === 0 ? '已逐个核对存在' : `其中 ${missing} 份不存在`}。`,
        (task.report?.unresolved ?? []).length === 0 ? '' : `遗留：${(task.report?.unresolved ?? []).join('；')}。`,
      ].filter((part) => part !== '').join(' ');
  return [
    '## STAR',
    `- **Situation**: ${situation}`,
    `- **Task**: ${oneLine(rounds[0]?.prompt ?? task.title, 300)}`,
    `- **Action**: ${action}`,
    `- **Result**: ${result}`,
  ];
}

function renderSession(doc: ContinuoWorkspaceDoc, task: ContinuoTask): string[] {
  const rounds = task.rounds ?? [];
  const sources = task.sources ?? [];
  const deliverables = task.report?.deliverables ?? [];
  const failure = failureText(task);
  const lines = ['### Meta Data', '', '| 字段 | 值 |', '|------|-----|', `| 开始时间 | ${stamp(task.createdAt)} |`];
  if (task.endedAt !== undefined) lines.push(`| 结束时间 | ${stamp(task.endedAt)} |`);
  lines.push(`| 状态 | ${TASK_STATUS_LABEL[task.status]}${failure === undefined ? '' : `（${failure}）`} |`);
  lines.push(`| 输入目录 | ${rootOfTask(doc, task)} |`);
  lines.push(`| 输入文件 | ${sources.length === 0 ? '—' : sources.join(', ')} |`);
  const plans = decisionsOfTask(doc, task).flatMap((decision) => decision.plans.map((plan) => ({ decision, plan })));
  const outputs = [...deliverables.map((item) => item.path), ...plans.map(({ plan }) => plan.path)];
  lines.push(`| 输出文件 | ${outputs.length === 0 ? '—' : outputs.join(', ')} |`);
  lines.push('', '### 原始任务描述', '', `> ${oneLine(rounds[0]?.prompt ?? task.title, 600)}`);
  if (rounds.length > 0) {
    lines.push('', '### 工作记录');
    for (const [index, round] of rounds.entries()) {
      const label = index === 0 ? taskName(task) : oneLine(round.prompt, 16);
      lines.push('', `#### [${localTime(round.at)}] 对话 ${index + 1} - ${label === '' ? '继续' : label}`);
      lines.push(`**输入**: ${index === 0 ? '同原始任务描述' : oneLine(round.prompt, 200)}`);
      const handled = [round.reads.length === 0 ? '' : `读 ${round.reads.join('、')}`, oneLine(round.reply, 200)].filter((part) => part !== '');
      lines.push(`**处理**: ${handled.length === 0 ? '—' : handled.join('；')}`);
      lines.push(`**产出**: ${round.writes.length === 0 ? '无文件产出' : round.writes.join('、')}`);
    }
  }
  if (deliverables.length > 0 || plans.length > 0) {
    lines.push('', '### 最终产出', '', '| 文件 | 说明 | 状态 |', '|------|------|------|');
    for (const item of deliverables) lines.push(`| ${item.path} | ${item.note === undefined || item.note === '' ? '—' : item.note} | ${item.exists === false ? '❌ 不存在' : '✅'} |`);
    for (const { decision, plan } of plans) lines.push(`| ${plan.path} | 方案 ${plan.planId}：${plan.title} | ${planStatusText(doc, task, decision, plan)} |`);
  }
  const notes = [
    ...(task.report?.unresolved ?? []).map((item) => `- 未完成：${item}`),
    ...(task.report?.nextStep === undefined ? [] : [`- 建议的下一步：${task.report.nextStep.title}——${task.report.nextStep.reason}`]),
  ];
  if (notes.length > 0) lines.push('', '### 备注', '', ...notes);
  return lines;
}
