import { CONTINUO_SCHEMA_VERSION, type ContinuoTask, type ContinuoWorkspaceDoc, type ContextEntry, type TaskTrigger, type Trajectory } from './types';

type Loose = Record<string, unknown>;

const TRIGGERS = new Set<TaskTrigger>(['first_open', 'user', 'resume', 'reply', 'plan']);

export function migrateWorkspaceDoc(stored: unknown): ContinuoWorkspaceDoc | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const version = (stored as Loose)['schemaVersion'];
  if (typeof version !== 'number') return undefined;
  if (version > CONTINUO_SCHEMA_VERSION) throw new Error(`这个项目是用更新版本的 Continuo 保存的（数据版本 ${version}），请更新后再打开。`);
  let doc = stored as Loose;
  if (version < 2) doc = fromV1(doc);
  if (version < 3) doc = fromV2(doc);
  return { ...(doc as unknown as ContinuoWorkspaceDoc), schemaVersion: CONTINUO_SCHEMA_VERSION };
}

function fromV1(doc: Loose): Loose {
  const { activity: _activity, ...rest } = doc;
  const context = ((doc['context'] as Loose[] | undefined) ?? [])
    .filter((entry) => entry['status'] === 'active' && (entry['scope'] as Loose | undefined)?.['type'] !== 'task')
    .map((entry): ContextEntry => ({ id: String(entry['id']), text: String(entry['text']), sourceRefs: (entry['sourceRefs'] as string[] | undefined) ?? [], createdAt: String(entry['createdAt']) }));
  const tasks = ((doc['tasks'] as Loose[] | undefined) ?? []).map((task) => {
    const trigger = task['trigger'] as string;
    return { ...task, trigger: TRIGGERS.has(trigger as TaskTrigger) ? trigger : trigger === 'reopen' ? 'resume' : 'user' };
  });
  const init = (doc['init'] as Loose | undefined) ?? { status: 'pending' };
  const { fingerprint: _fingerprint, ...initRest } = init;
  return { ...rest, context, tasks, init: initRest };
}

function fromV2(doc: Loose): Loose {
  const tasks = (doc['tasks'] as ContinuoTask[] | undefined) ?? [];
  const user = tasks.filter((task) => task.kind === 'user');
  const last = user.at(-1);
  const trajectories: Trajectory[] = last === undefined ? [] : [{
    trajectoryId: 'trj_restored',
    label: '',
    sessionId: last.sessionId,
    status: 'current',
    taskIds: user.map((task) => task.taskId),
    choices: [],
    turnCount: user.filter((task) => task.sessionId === last.sessionId).reduce((sum, task) => sum + task.promptIds.length, 0),
    createdAt: user[0]!.createdAt,
  }];
  return { ...doc, trajectories, decisions: [] };
}
