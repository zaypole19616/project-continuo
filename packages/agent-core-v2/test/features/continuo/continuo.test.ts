import { describe, expect, it } from 'vitest';

import type { IDisposable } from '#/_base/di/lifecycle';
import { bundleDigest, shouldInject } from '#/features/continuo/bridge';
import { compileContextBundle, CONTEXT_BUNDLE_MAX_CHARS } from '#/features/continuo/contextBundle';
import { ContinuoStoreService } from '#/features/continuo/store';
import { buildTrajectoryExport } from '#/features/continuo/export';
import { migrateWorkspaceDoc } from '#/features/continuo/migrate';
import { afterRun, dueTodo, nextRunAt, scheduleOf } from '#/features/continuo/todo';
import { joinFragments } from '#/features/continuo/tools/report-result/reportResultTool';
import { SubmitPlanTool } from '#/features/continuo/tools/submit-plan/submitPlanTool';
import { stopsBatch, TrajectoryTool } from '#/features/continuo/tools/trajectory/trajectoryTool';
import { doneOnLine, guardAccesses, guardTool, inheritedChoices, otherLineNote, decisionStance, planIds, planPath, planStatusOn, tasksThrough } from '#/features/continuo/trajectory';
import {
  CONTINUO_STORE_SCOPE,
  currentTaskOf,
  EMPTY_USAGE,
  newWorkspaceDoc,
  type ContextEntry,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
  type Decision,
  type Trajectory,
} from '#/features/continuo/types';
import type { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import type { ISessionContext } from '#/session/sessionContext/sessionContext';
import type { ExecutableToolResult, ToolExecution } from '#/tool/toolContract';

const NOW = '2026-09-20T00:00:00.000Z';

function entry(overrides: Partial<ContextEntry> & { id: string; text: string }): ContextEntry {
  return { sourceRefs: [], createdAt: NOW, ...overrides };
}

function task(overrides: Partial<ContinuoTask> = {}): ContinuoTask {
  return {
    taskId: 'task_1',
    kind: 'user',
    title: 'write the Q2 review',
    trigger: 'user',
    sessionId: 'session_1',
    promptIds: [],
    status: 'running',
    pauseRequested: false,
    usage: EMPTY_USAGE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function docWith(context: readonly ContextEntry[], extra: Partial<ContinuoWorkspaceDoc> = {}): ContinuoWorkspaceDoc {
  return { ...newWorkspaceDoc('wd_1', '/tmp/ws'), revision: 7, context, ...extra };
}

class MemoryDocumentStore implements IAtomicDocumentStore {
  declare readonly _serviceBrand: undefined;
  readonly docs = new Map<string, unknown>();
  writes = 0;

  get<T>(scope: string, key: string): Promise<T | undefined> {
    return Promise.resolve(this.docs.get(`${scope}/${key}`) as T | undefined);
  }

  set<T>(scope: string, key: string, value: T): Promise<void> {
    this.writes += 1;
    this.docs.set(`${scope}/${key}`, structuredClone(value));
    return Promise.resolve();
  }

  delete(scope: string, key: string): Promise<void> {
    this.docs.delete(`${scope}/${key}`);
    return Promise.resolve();
  }

  list(scope: string, prefix = ''): Promise<readonly string[]> {
    const out: string[] = [];
    for (const key of this.docs.keys()) {
      if (key.startsWith(`${scope}/${prefix}`)) out.push(key.slice(scope.length + 1));
    }
    return Promise.resolve(out);
  }

  acquire(): IDisposable {
    return { dispose: () => undefined };
  }
}

describe('currentTaskOf', () => {
  it('picks the unfinished task on that session, not the first one to use it', () => {
    const done = task({ taskId: 'task_1', endedAt: NOW });
    const running = task({ taskId: 'task_2' });
    const other = task({ taskId: 'task_3', sessionId: 'session_other' });
    const doc = { ...docWith([]), tasks: [done, running, other] };
    expect(currentTaskOf(doc, 'session_1')?.taskId).toBe('task_2');
    expect(currentTaskOf(doc, 'session_other')?.taskId).toBe('task_3');
    expect(currentTaskOf(doc, 'session_none')).toBeUndefined();
  });

  it('falls back to the last finished task once the session is idle', () => {
    const first = task({ taskId: 'task_1', endedAt: NOW });
    const second = task({ taskId: 'task_2', endedAt: NOW });
    const doc = { ...docWith([]), tasks: [first, second] };
    expect(currentTaskOf(doc, 'session_1')?.taskId).toBe('task_2');
  });
});

function line(overrides: Partial<Trajectory> & { trajectoryId: string }): Trajectory {
  return { label: '', sessionId: 'session_1', status: 'current', taskIds: [], choices: [], turnCount: 0, createdAt: NOW, ...overrides };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  const plan = (planId: string, title: string) => ({ planId, title, basis: `basis ${planId}`, risk: `risk ${planId}`, prompt: `go ${planId}`, path: `work-log/plan-${planId}.md`, createdAt: NOW });
  return { decisionId: 'dec_1', taskId: 'task_1', trajectoryId: 'main', question: 'Which target?', turnIndex: 2, plans: [plan('A', 'grow 10%'), plan('B', 'keep budget'), plan('C', 'wait')], createdAt: NOW, ...overrides };
}

function bundleFor(doc: ContinuoWorkspaceDoc, current: ContinuoTask) {
  return compileContextBundle({ ...doc, tasks: [...doc.tasks.filter((candidate) => candidate.taskId !== current.taskId), current] }, current.sessionId);
}

describe('trajectory', () => {
  it('tells each plan apart on the line being viewed', () => {
    const dec = decision({ plans: decision().plans.map((plan) => (plan.planId === 'C' ? { ...plan, abandoned: { reason: 'too late', at: NOW } } : plan)) });
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'], choices: [{ decisionId: 'dec_1', planId: 'A', turnIndex: 3, at: NOW }] });
    const other = line({ trajectoryId: 'b', sessionId: 'session_2', status: 'alternative', choices: [{ decisionId: 'dec_1', planId: 'B', turnIndex: 3, at: NOW }] });
    const doc = { ...docWith([]), trajectories: [main, other], decisions: [dec] };
    const [a, b, c] = dec.plans;
    expect(planStatusOn(doc, main, dec, a!).kind).toBe('current');
    expect(planStatusOn(doc, main, dec, b!)).toMatchObject({ kind: 'elsewhere', trajectory: { trajectoryId: 'b' } });
    expect(planStatusOn(doc, main, dec, c!).kind).toBe('abandoned');
    expect(planStatusOn(doc, other, dec, a!)).toMatchObject({ kind: 'elsewhere', trajectory: { trajectoryId: 'main' } });
    expect(planStatusOn(doc, { ...other, status: 'abandoned' }, dec, b!).kind).toBe('current');
  });

  it('copies only the choices made at or before the fork turn', () => {
    const parent = line({ trajectoryId: 'main', choices: [
      { decisionId: 'd1', planId: 'A', turnIndex: 1, at: NOW },
      { decisionId: 'd2', planId: 'B', turnIndex: 5, at: NOW },
    ] });
    expect(inheritedChoices(parent, 4).map((choice) => choice.decisionId)).toEqual(['d1']);
    expect(inheritedChoices(parent, 5).map((choice) => choice.decisionId)).toEqual(['d1', 'd2']);
  });

  it('hands out the next letter that no plan uses yet', () => {
    const next = planIds(['B', 'C']);
    expect([next(), next(), next()]).toEqual(['A', 'D', 'E']);
  });

  it('keeps the tasks of a line up to the first one that fails the test', () => {
    const tasks = ['t1', 't2', 't3'].map((taskId) => task({ taskId }));
    const doc = { ...docWith([]), tasks };
    const parent = line({ trajectoryId: 'main', taskIds: ['t1', 't2', 't3'] });
    expect(tasksThrough(doc, parent, (candidate) => candidate.taskId !== 't3')).toEqual(['t1', 't2']);
  });

  it('names plan files after the task, one file per plan', () => {
    const named = task({ name: 'Q4目标', category: 'review' });
    expect(planPath(named, 'B', '2026-09-23T04:00:00.000Z')).toMatch(/^work-log\/plan-2026-09-2\d-review-Q4目标-方案B\.md$/);
    expect(planPath(task({ title: '按区域拆一版 Q4 目标，说明口径' }), 'A', NOW)).toContain('-按区域拆一版-Q4-目标-方案A.md');
  });

  it('injects the plan being followed and points at the files of the others', () => {
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'], choices: [{ decisionId: 'dec_1', planId: 'A', turnIndex: 3, at: NOW }] });
    const doc = { ...docWith([], { understanding: { text: 'Q4 planning', sourceRefs: [], updatedAt: NOW } }), trajectories: [main], decisions: [decision()] };
    const text = bundleFor(doc, task())!;
    expect(text).toContain('Following 「grow 10%」 (id A). Basis: basis A Risk: risk A');
    expect(text).toContain('「keep budget」 (id B) — not taken. work-log/plan-B.md');
    expect(text).not.toMatch(/\bPlan [A-Z]\b/);
    expect(text).not.toContain('basis B');
  });

  it('marks a decision that is still open so the agent waits for the user', () => {
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'] });
    const doc = { ...docWith([], { understanding: { text: 'Q4 planning', sourceRefs: [], updatedAt: NOW } }), trajectories: [main], decisions: [decision()] };
    expect(bundleFor(doc, task())!).toContain('Still open: the user has not picked a plan yet.');
  });
});

describe('compileContextBundle', () => {
  it('returns nothing when the folder has neither an understanding nor any points', () => {
    expect(bundleFor(docWith([]), task())).toBeUndefined();
  });

  it('injects the understanding, the points with their sources and the current task', () => {
    const doc = docWith([
      entry({ id: 'conv', text: 'deliverables go in drafts/', sourceRefs: ['README.md'] }),
      entry({ id: 'bg', text: 'materials/ is read-only', sourceRefs: ['AGENTS.md'] }),
    ], { understanding: { text: 'A folder for the Q2 review.', sourceRefs: ['README.md'], updatedAt: NOW } });
    const text = bundleFor(doc, task({ supplements: ['keep it under 150 words'] }))!;
    expect(text).toContain('A folder for the Q2 review.');
    expect(text).toContain('- deliverables go in drafts/ (source: README.md)');
    expect(text.indexOf('deliverables go in drafts/')).toBeLessThan(text.indexOf('materials/ is read-only'));
    expect(text).toContain('Current task: write the Q2 review');
    expect(text).toContain('The user added: keep it under 150 words');
  });

  it('carries project data only and leaves the working rules to the profile and the tools', () => {
    const doc = docWith([], { understanding: { text: 'Q2 review folder', sourceRefs: [], updatedAt: NOW } });
    expect(bundleFor(doc, task())!).not.toMatch(/Trajectory|AskUserQuestion|ReportWorkspaceResult|SubmitPlan/);
  });

  it('stays within the character budget', () => {
    const filler = Array.from({ length: 40 }, (_, index) => entry({ id: `m${index}`, text: 'm'.repeat(400) }));
    const text = bundleFor(docWith(filler), task())!;
    expect(text.split('\n').filter((row) => row.startsWith('- m')).length).toBeLessThanOrEqual(30);
    expect(text.length).toBeLessThanOrEqual(CONTEXT_BUNDLE_MAX_CHARS + 600);
  });
});

describe('ContinuoStoreService', () => {
  it('creates a document once and bumps the revision on every update', async () => {
    const documents = new MemoryDocumentStore();
    const store = new ContinuoStoreService(documents);
    const created = await store.ensure('wd_1', '/tmp/ws');
    expect(created.revision).toBe(1);
    expect(await store.ensure('wd_1', '/other')).toEqual(created);
    const updated = await store.update('wd_1', (doc) => ({ ...doc, openCount: doc.openCount + 1 }));
    expect(updated.revision).toBe(2);
    expect(updated.openCount).toBe(1);
    expect(await documents.get(CONTINUO_STORE_SCOPE, 'wd_1')).toMatchObject({ revision: 2, openCount: 1 });
  });

  it('serializes concurrent updates so no mutation is lost', async () => {
    const store = new ContinuoStoreService(new MemoryDocumentStore());
    await store.ensure('wd_1', '/tmp/ws');
    await Promise.all(Array.from({ length: 25 }, () => store.update('wd_1', (doc) => ({ ...doc, openCount: doc.openCount + 1 }))));
    const doc = await store.load('wd_1');
    expect(doc?.openCount).toBe(25);
    expect(doc?.revision).toBe(26);
  });

  it('never treats an in-flight atomic write as a workspace', async () => {
    const documents = new MemoryDocumentStore();
    const store = new ContinuoStoreService(documents);
    await store.ensure('wd_1', '/tmp/ws');
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_1.tmp.123.abc', await documents.get(CONTINUO_STORE_SCOPE, 'wd_1'));
    expect(await store.workspaceIds()).toEqual(['wd_1']);
    expect(await store.load('wd_1.tmp.123.abc')).toBeUndefined();
  });

  it('notifies listeners until they unsubscribe', async () => {
    const store = new ContinuoStoreService(new MemoryDocumentStore());
    await store.ensure('wd_1', '/tmp/ws');
    const seen: number[] = [];
    const off = store.onDidChange((doc) => { seen.push(doc.revision); });
    await store.update('wd_1', (current) => ({ ...current, openCount: 1 }));
    off();
    await store.update('wd_1', (current) => ({ ...current, openCount: 2 }));
    expect(seen).toEqual([2]);
  });

  it('upgrades a project saved by an earlier version instead of starting over', async () => {
    const documents = new MemoryDocumentStore();
    const v3 = { ...newWorkspaceDoc('wd_old', '/tmp/old'), schemaVersion: 3, openCount: 4, tasks: [task({ taskId: 't1', sessionId: 's1' })], trajectories: [line({ trajectoryId: 'main', sessionId: 's1', taskIds: ['t1'] })] };
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_old', v3);
    const store = new ContinuoStoreService(documents);
    const doc = await store.load('wd_old');
    expect(doc).toMatchObject({ schemaVersion: 4, openCount: 4, tasks: [{ taskId: 't1' }], trajectories: [{ trajectoryId: 'main' }] });
    expect(await documents.get(CONTINUO_STORE_SCOPE, 'wd_old')).toMatchObject({ schemaVersion: 4 });
    expect((await store.ensure('wd_old', '/tmp/old')).openCount).toBe(4);
  });

  it('turns the one conversation of a v2 project into its first line', () => {
    const v2 = { ...newWorkspaceDoc('wd_2', '/tmp/v2'), schemaVersion: 2, trajectories: undefined, decisions: undefined, tasks: [task({ taskId: 'init', kind: 'init', sessionId: 's_init' }), task({ taskId: 't1', sessionId: 's1', promptIds: ['p1', 'p2'] }), task({ taskId: 't2', sessionId: 's1', promptIds: ['p3'] })] };
    const doc = migrateWorkspaceDoc(v2)!;
    expect(doc.schemaVersion).toBe(4);
    expect(doc.decisions).toEqual([]);
    expect(doc.trajectories).toEqual([expect.objectContaining({ sessionId: 's1', status: 'current', taskIds: ['t1', 't2'], turnCount: 3 })]);
  });

  it('keeps only the active project-wide entries of a v1 ledger', () => {
    const v1 = {
      ...newWorkspaceDoc('wd_1', '/tmp/v1'), schemaVersion: 1, activity: [{ at: NOW, kind: 'system', text: 'x' }], init: { status: 'completed', fingerprint: 'abc' },
      context: [
        { id: 'c1', kind: 'convention', text: 'H1 starts with Northwind', scope: { type: 'workspace' }, sourceRefs: ['AGENTS.md'], origin: 'file', status: 'active', revision: 1, createdAt: NOW, updatedAt: NOW },
        { id: 'c2', kind: 'convention', text: 'maybe', scope: { type: 'workspace' }, sourceRefs: [], origin: 'agent', status: 'candidate', revision: 1, createdAt: NOW, updatedAt: NOW },
      ],
      tasks: [task({ taskId: 't1', sessionId: 's1', trigger: 'reopen' as never })],
    };
    const doc = migrateWorkspaceDoc(v1)!;
    expect(doc.context).toEqual([{ id: 'c1', text: 'H1 starts with Northwind', sourceRefs: ['AGENTS.md'], createdAt: NOW }]);
    expect(doc.tasks[0]!.trigger).toBe('resume');
    expect('activity' in doc).toBe(false);
    expect(doc.init).toEqual({ status: 'completed' });
    expect(doc.trajectories[0]!.taskIds).toEqual(['t1']);
  });

  it('carries the reason of an old failed task into its error field on load', () => {
    const stored = {
      ...newWorkspaceDoc('wd_e', '/tmp/e'),
      tasks: [
        { ...task({ taskId: 't1', status: 'failed', endedAt: NOW }), lastError: 'usage limit reached' },
        { ...task({ taskId: 't2', status: 'failed', error: { code: 'provider.rate_limit', message: '429', at: NOW } }), lastError: '模型服务暂时忙不过来' },
        task({ taskId: 't3' }),
      ],
    };
    const doc = migrateWorkspaceDoc(stored)!;
    expect(doc.tasks.map((candidate) => candidate.error)).toEqual([{ code: 'turn.failed', message: 'usage limit reached', at: NOW }, { code: 'provider.rate_limit', message: '429', at: NOW }, undefined]);
    expect(doc.tasks.some((candidate) => 'lastError' in candidate)).toBe(false);
  });

  it('refuses to open a project saved by a newer version rather than overwrite it', async () => {
    const documents = new MemoryDocumentStore();
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_new', { ...newWorkspaceDoc('wd_new', '/tmp/new'), schemaVersion: 99 });
    await expect(new ContinuoStoreService(documents).ensure('wd_new', '/tmp/new')).rejects.toThrow('更新版本');
    expect(await documents.get(CONTINUO_STORE_SCOPE, 'wd_new')).toMatchObject({ schemaVersion: 99 });
  });
});

describe('line isolation guard', () => {
  const guard = (d: ContinuoWorkspaceDoc, sessionId: string, accesses: Array<{ operation: string; path: string }>, existing: string[] = []) => guardAccesses(d, sessionId, accesses, new Set(existing));
  const root = '/p';
  const main = line({ trajectoryId: 'main', sessionId: 's_main', taskIds: ['t1'] });
  const branch = line({ trajectoryId: 'b', sessionId: 's_b', status: 'alternative', workDir: '/p/.continuo/lines/b', taskIds: ['t1', 't2'] });
  const doc = { ...newWorkspaceDoc('wd_1', root), trajectories: [main, branch], tasks: [task({ taskId: 't1', sessionId: 's_main' }), task({ taskId: 't2', sessionId: 's_b' })] };

  it('keeps a branched line inside its own directory', () => {
    expect(guard(doc, 's_b', [{ operation: 'write', path: '/p/.continuo/lines/b/drafts/x.md' }])).toBeUndefined();
    expect(guard(doc, 's_b', [{ operation: 'read', path: '/p/.continuo/lines/b/materials/a.md' }])).toBeUndefined();
    expect(guard(doc, 's_b', [{ operation: 'write', path: '/p/drafts/x.md' }])).toContain('/p/.continuo/lines/b');
    expect(guard(doc, 's_b', [{ operation: 'read', path: '/p/drafts/x.md' }])).toContain('Denied: /p/drafts/x.md');
    expect(guard(doc, 's_b', [{ operation: 'read', path: '/elsewhere/notes.md' }])).toBeUndefined();
  });

  it('keeps the main line out of the other lines', () => {
    expect(guard(doc, 's_main', [{ operation: 'write', path: '/p/drafts/x.md' }])).toBeUndefined();
    expect(guard(doc, 's_main', [{ operation: 'read', path: '/p/.continuo/lines/b/drafts/x.md' }])).toContain("Continuo's own records");
    expect(guard(doc, 's_main', [{ operation: 'write', path: '/p/.continuo/lines/b/x.md' }])).toBeDefined();
    expect(guard(doc, 's_main', [{ operation: 'write', path: '/tmp/elsewhere.md' }])).toContain('stays inside its folder, /p');
  });

  describe('lines sharing the project folder', () => {
    const report = (path: string) => ({ summary: 's', deliverables: [{ path }], unresolved: [], reportedAt: NOW });
    const solo = { ...newWorkspaceDoc('wd_s', root), trajectories: [line({ trajectoryId: 'main', sessionId: 's_main', taskIds: ['t1'] })], tasks: [task({ taskId: 't1', sessionId: 's_main', report: report('drafts/a.md') })] };
    const forked = {
      ...solo,
      trajectories: [
        line({ trajectoryId: 'main', sessionId: 's_main', taskIds: ['t1', 't2'] }),
        line({ trajectoryId: 'c', sessionId: 's_c', status: 'alternative', taskIds: ['t1', 't3'], origin: { fromTrajectoryId: 'main', turnIndex: 1, decisionId: 'd1', planId: 'C' } }),
      ],
      tasks: [task({ taskId: 't1', sessionId: 's_main', report: report('drafts/a.md') }), task({ taskId: 't2', sessionId: 's_main', report: report('drafts/b.md') }), task({ taskId: 't3', sessionId: 's_c', report: report('drafts/c.md') })],
    };

    it('changes any file freely while there is only one line', () => {
      expect(guard(solo, 's_main', [{ operation: 'readwrite', path: '/p/README.md' }], ['/p/README.md'])).toBeUndefined();
      expect(guard(solo, 's_main', [{ operation: 'write', path: '/p/drafts/a.md' }], ['/p/drafts/a.md'])).toBeUndefined();
    });

    it('lets a line change its own files, files from before the fork and files it shares with another line', () => {
      expect(guard(forked, 's_c', [{ operation: 'write', path: '/p/drafts/new.md' }])).toBeUndefined();
      expect(guard(forked, 's_c', [{ operation: 'readwrite', path: '/p/drafts/c.md' }], ['/p/drafts/c.md'])).toBeUndefined();
      expect(guard(forked, 's_c', [{ operation: 'readwrite', path: '/p/README.md' }], ['/p/README.md'])).toBeUndefined();
      expect(guard(forked, 's_c', [{ operation: 'write', path: '/p/drafts/a.md' }], ['/p/drafts/a.md'])).toBeUndefined();
    });

    it('keeps files another line wrote as they are and names the copy to change instead', () => {
      expect(guard(forked, 's_c', [{ operation: 'write', path: '/p/drafts/b.md' }], ['/p/drafts/b.md'])).toContain('/p/drafts/b-方案C.md');
      expect(guard(forked, 's_main', [{ operation: 'readwrite', path: '/p/drafts/c.md' }], ['/p/drafts/c.md'])).toContain('/p/drafts/c-原轨迹.md');
      const abandoned = { ...forked, trajectories: [forked.trajectories[0]!, { ...forked.trajectories[1]!, status: 'abandoned' as const }] };
      expect(guard(abandoned, 's_main', [{ operation: 'write', path: '/p/drafts/c.md' }], ['/p/drafts/c.md'])).toContain('written on another line');
    });

    it('treats a file the user deleted as gone rather than protected', () => {
      expect(guard(forked, 's_c', [{ operation: 'write', path: '/p/drafts/b.md' }], [])).toBeUndefined();
    });

    it('tells each line which files belong to the others', () => {
      const bundle = compileContextBundle({ ...forked, understanding: { text: 'u', sourceRefs: [], updatedAt: NOW } }, 's_c')!;
      expect(bundle).toContain('Other lines of this project work in this same folder.');
      expect(bundle).toContain('drafts/b.md');
      expect(bundle).not.toContain('drafts/c.md,');
      expect(bundle).toContain('"-方案C"');
      expect(bundle).toContain('notes-方案C.md');
    });
  });

  it('lets a plan author read but never write', () => {
    const exploring = { ...decision(), plans: [], exploration: { reason: 'r', angles: [{ key: 'A', title: 'a', angle: 'look at x', status: 'running' as const, sessionId: 's_author' }], messages: [], maxSteps: 8, startedAt: NOW } };
    const withAuthor = { ...doc, decisions: [exploring] };
    expect(guard(withAuthor, 's_author', [{ operation: 'read', path: '/p/materials/a.md' }])).toBeUndefined();
    expect(guard(withAuthor, 's_author', [{ operation: 'write', path: '/p/drafts/a.md' }])).toContain('SubmitPlan submit');
    expect(guardTool(withAuthor, 's_author', 'Bash', '/p')).toContain('Read, Grep and Glob');
    expect(guardTool(withAuthor, 's_author', 'AskUserQuestion', undefined)).toContain('SubmitPlan ask');
    expect(guardTool(withAuthor, 's_author', 'Grep', undefined)).toBeUndefined();
  });

  it('runs shell commands of a branched line inside its directory', () => {
    expect(guardTool(doc, 's_b', 'Bash', '/p/.continuo/lines/b')).toBeUndefined();
    expect(guardTool(doc, 's_b', 'Bash', '/p/.continuo/lines/b/drafts')).toBeUndefined();
    expect(guardTool(doc, 's_b', 'Bash', undefined)).toContain('cwd set to that directory');
    expect(guardTool(doc, 's_b', 'Bash', '/p')).toContain('/p/.continuo/lines/b');
    expect(guardTool(doc, 's_main', 'Bash', undefined)).toBeUndefined();
    expect(guardTool(doc, 's_main', 'AskUserQuestion', undefined)).toBeUndefined();
  });
});

describe('branch context (phase four)', () => {
  it('lists what is done on the line and sums up what another line did with a plan', () => {
    const done = task({ taskId: 't0', name: '复盘', status: 'completed', report: { summary: 's', deliverables: [{ path: 'drafts/r.md', exists: true }], unresolved: [], reportedAt: NOW } });
    const other = task({ taskId: 't3b', sessionId: 's_b', rounds: [{ at: NOW, prompt: 'p', reads: [], writes: ['drafts/b.md'], reply: '' }, { at: NOW, prompt: 'q', reads: [], writes: [], reply: '' }], report: { summary: 's', deliverables: [{ path: 'drafts/b.md' }], unresolved: [], reportedAt: NOW } });
    const main = line({ trajectoryId: 'main', taskIds: ['t0', 'task_1'], choices: [{ decisionId: 'dec_1', planId: 'A', turnIndex: 3, at: NOW }] });
    const b = line({ trajectoryId: 'b', sessionId: 's_b', status: 'alternative', taskIds: ['t0', 't3b'], choices: [{ decisionId: 'dec_1', planId: 'B', turnIndex: 3, at: NOW }] });
    const doc = { ...docWith([], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), tasks: [done, other], trajectories: [main, b], decisions: [decision()] };
    expect(doneOnLine({ ...doc, tasks: [done, other, task()] }, main, 'task_1')).toEqual([{ name: '复盘', deliverables: ['drafts/r.md'] }]);
    expect(otherLineNote(doc, main, decision(), decision().plans[1]!)).toBe('followed on another line: 1 task, 2 rounds, produced drafts/b.md');
    const text = bundleFor(doc, task())!;
    expect(text).toContain('Done on this line');
    expect(text).toContain('- 复盘 → drafts/r.md');
    expect(text).toContain('「keep budget」 (id B) — followed on another line: 1 task, 2 rounds, produced drafts/b.md.');
  });

  it('tells a branched line where its directory is', () => {
    const b = line({ trajectoryId: 'b', workDir: '/tmp/ws/.continuo/lines/b' });
    const doc = { ...docWith([], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), trajectories: [b] };
    expect(bundleFor(doc, task())!).toContain('Working directory of this line: /tmp/ws/.continuo/lines/b');
  });

  it('briefs a plan author on its angle, the other authors and its messages only', () => {
    const exploring = { ...decision(), plans: [], exploration: { reason: 'r', angles: [
      { key: 'A', title: 'top down', angle: 'start from the budget', status: 'running' as const, sessionId: 's_a' },
      { key: 'B', title: 'bottom up', angle: 'start from delivery capacity', status: 'running' as const, sessionId: 's_b' },
    ], messages: [{ from: 'B', to: 'A', text: 'which budget file?', at: NOW }, { from: 'A', to: 'B', text: 'budget-2026.md', at: NOW }], maxSteps: 8, startedAt: NOW } };
    const doc = { ...docWith([], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), trajectories: [line({ trajectoryId: 'main', taskIds: ['task_1'] })], tasks: [task()], decisions: [exploring] };
    const text = compileContextBundle(doc, 's_a')!;
    expect(text).toContain('You are the author of plan A');
    expect(text).toContain('Your angle: top down — start from the budget');
    expect(text).toContain('Step budget: 8 steps.');
    expect(text).toContain('- B bottom up — start from delivery capacity');
    expect(text).toContain('from B: which budget file?');
    expect(text).not.toContain('budget-2026.md');
    expect(text).not.toContain('Current task');
  });
});

describe('trajectory export (phase five)', () => {
  it('turns every line into a sample and every decision into preference pairs, strongest signal first', () => {
    const dec = { ...decision(), plans: decision().plans.map((plan) => (plan.planId === 'C' ? { ...plan, abandoned: { reason: 'too late', at: NOW } } : plan)) };
    const t1 = task({ taskId: 'task_1', status: 'completed', rounds: [{ at: NOW, prompt: 'split Q4', reads: ['m.md'], writes: ['d.md'], reply: 'ok' }], report: { summary: 's', deliverables: [{ path: 'd.md', exists: true }], unresolved: [], reportedAt: NOW } });
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'], choices: [{ decisionId: 'dec_1', planId: 'A', turnIndex: 3, at: NOW }] });
    const b = line({ trajectoryId: 'b', sessionId: 's_b', status: 'alternative', taskIds: [], choices: [{ decisionId: 'dec_1', planId: 'B', turnIndex: 3, at: NOW }], origin: { fromTrajectoryId: 'main', turnIndex: 2, decisionId: 'dec_1', planId: 'B' } });
    const doc = { ...docWith([]), tasks: [t1], trajectories: [main, b], decisions: [dec] };
    const out = buildTrajectoryExport(doc, new Map([['task_1:d.md', { exists: true, modifiedAfter: true }]]), NOW);
    expect(out.samples).toHaveLength(2);
    const sample = out.samples.find((item) => item.trajectoryId === 'main')!;
    expect(sample.current).toBe(true);
    expect(sample.tasks[0]).toMatchObject({ request: 'split Q4', deliverables: [{ path: 'd.md', modifiedAfter: true, usedLater: false }] });
    expect(sample.decisions[0]!.plans.map((plan) => plan.fate)).toEqual(['chosen', 'taken_elsewhere', 'abandoned']);
    expect(out.samples.find((item) => item.trajectoryId === 'b')!.branchedFrom).toMatchObject({ kind: 'plan', planId: 'B' });
    expect(out.preferences.map((pair) => `${pair.preferred.planId}>${pair.other.planId}:${pair.signal}`)).toEqual(['A>C:abandoned', 'A>B:switched_away']);
    expect(out.preferences[0]!.reason).toBe('too late');
  });

  it('keeps the project context once and reads from the backlog whether the next step was started', () => {
    const suggested = task({ taskId: 'task_1', status: 'completed', report: { summary: 's', deliverables: [], unresolved: [], nextStep: { title: '一个远远超过一百二十个字符截断规则也不会影响判断的很长很长很长的标题', reason: 'r', prompt: 'do the follow-up' }, reportedAt: NOW } });
    const base = { ...docWith([entry({ id: 'p1', text: 'drafts/ holds output' })], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), tasks: [suggested], trajectories: [line({ trajectoryId: 'main', taskIds: ['task_1'] })] };
    const idle = buildTrajectoryExport(base, new Map(), NOW);
    expect(idle.workspace.context).toEqual({ understanding: 'Q4', points: ['drafts/ holds output'] });
    expect(idle.samples[0]).not.toHaveProperty('context');
    expect(idle.samples[0]!.tasks[0]!.nextStep?.started).toBe(false);
    const fromTask = { ...base, todos: [{ todoId: 'td', text: 'do the follow-up', fromTaskId: 'task_1', state: 'started' as const, taskId: 'task_2', createdAt: NOW }] };
    expect(buildTrajectoryExport(fromTask, new Map(), NOW).samples[0]!.tasks[0]!.nextStep?.started).toBe(true);
    const byText = { ...base, todos: [{ todoId: 'td', text: 'do the follow-up', state: 'started' as const, taskId: 'task_2', createdAt: NOW }] };
    expect(buildTrajectoryExport(byText, new Map(), NOW).samples[0]!.tasks[0]!.nextStep?.started).toBe(true);
  });
});

describe('where the agent stands on the plans', () => {
  it('always records what the choice comes down to, and a recommendation only with its reason', () => {
    expect(decisionStance([], undefined, 'reading speed or per-city ownership', NOW)).toEqual({ dependsOn: 'reading speed or per-city ownership', at: NOW });
    expect(decisionStance(['B'], 'the guide asks for conclusions first', 'reading speed or per-city ownership', NOW)).toEqual({ dependsOn: 'reading speed or per-city ownership', pick: 'B', why: 'the guide asks for conclusions first', at: NOW });
    expect(decisionStance(['B'], 'why', undefined, NOW)).toMatch(/Always give dependsOn/);
    expect(decisionStance(['A', 'B'], 'both', 'd', NOW)).toMatch(/at most one/);
    expect(decisionStance(['A'], undefined, 'd', NOW)).toMatch(/needs why/);
  });
});

describe('backlog timing (built on the cron scheduler)', () => {
  const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();

  it('turns a time picked in the product into a cron schedule', () => {
    expect(scheduleOf({ kind: 'daily', time: '9:05' })).toEqual({ cron: '5 9 * * *', recurring: true });
    expect(scheduleOf({ kind: 'weekly', day: 1, time: '18:30' })).toEqual({ cron: '30 18 * * 1', recurring: true });
    expect(scheduleOf({ kind: 'once', at: new Date(local(2026, 9, 24, 14, 0)).toISOString() })).toEqual({ cron: '0 14 24 9 *', recurring: false });
    expect(scheduleOf({ kind: 'daily', time: '25:00' })).toBeUndefined();
    expect(scheduleOf({ kind: 'weekly', day: 9, time: '09:00' })).toBeUndefined();
  });

  it('finds the next run and the todo that is due first', () => {
    const daily = { ...scheduleOf({ kind: 'daily', time: '09:00' })!, label: '每天 09:00' };
    expect(nextRunAt(daily, local(2026, 9, 23, 13, 0))).toBe(new Date(local(2026, 9, 24, 9, 0)).toISOString());
    const now = local(2026, 9, 24, 9, 1);
    const doc = { ...newWorkspaceDoc('wd_t', '/p'), todos: [
      { todoId: 'later', text: 'b', schedule: daily, nextAt: new Date(local(2026, 9, 25, 9, 0)).toISOString(), createdAt: NOW },
      { todoId: 'due', text: 'a', schedule: daily, nextAt: new Date(local(2026, 9, 24, 9, 0)).toISOString(), createdAt: NOW },
      { todoId: 'manual', text: 'c', createdAt: NOW },
    ] };
    expect(dueTodo(doc, now)?.todoId).toBe('due');
    const handled = { ...doc, todos: doc.todos.map((todo) => (todo.todoId === 'due' ? { ...todo, state: 'dismissed' as const } : todo)) };
    expect(dueTodo(handled, now)).toBeUndefined();
  });

  it('moves a recurring todo to its next run after missed ones, and drops a one-off', () => {
    const daily = { ...scheduleOf({ kind: 'daily', time: '09:00' })!, label: '每天 09:00' };
    const late = local(2026, 9, 27, 10, 0);
    const recurring = afterRun({ todoId: 'd', text: 'a', schedule: daily, nextAt: new Date(local(2026, 9, 24, 9, 0)).toISOString(), createdAt: NOW }, late);
    expect(recurring?.nextAt).toBe(new Date(local(2026, 9, 28, 9, 0)).toISOString());
    expect(afterRun({ todoId: 'o', text: 'a', schedule: { ...scheduleOf({ kind: 'once', at: new Date(late).toISOString() })!, label: '' }, createdAt: NOW }, late)).toBeUndefined();
    expect(afterRun({ todoId: 'm', text: 'a', createdAt: NOW }, late)).toBeUndefined();
  });
});

describe('context injection', () => {
  const understood = { understanding: { text: 'Q4 planning', sourceRefs: [], updatedAt: NOW } };
  const textOf = (revision: number, current: ContinuoTask) => compileContextBundle({ ...docWith([], understood), revision, tasks: [current] }, current.sessionId)!;

  it('does not inject again while the content is unchanged, whatever the revision', () => {
    const before = textOf(7, task());
    const after = textOf(8, task());
    expect(before).not.toContain('revision');
    expect(bundleDigest(after)).toBe(bundleDigest(before));
    expect(shouldInject({ digest: bundleDigest(before) }, bundleDigest(after), false)).toBe(false);
  });

  it('does not inject again when only the task status moves during a turn', () => {
    const digests = (['queued', 'running', 'awaiting_user'] as const).map((status) => bundleDigest(textOf(7, task({ status }))));
    expect(new Set(digests).size).toBe(1);
  });

  it('injects when the content changed, on a new turn, and when nothing was injected yet', () => {
    const before = bundleDigest(textOf(7, task()));
    const changed = bundleDigest(textOf(7, task({ supplements: ['keep it short'] })));
    expect(changed).not.toBe(before);
    expect(shouldInject({ digest: before }, changed, false)).toBe(true);
    expect(shouldInject({ digest: before }, before, true)).toBe(true);
    expect(shouldInject(undefined, before, false)).toBe(true);
  });
});

describe('Trajectory and SubmitPlan tools', () => {
  const sessionOf = (sessionId: string): ISessionContext => ({ _serviceBrand: undefined, sessionId, workspaceId: 'wd_1', sessionDir: '/tmp/s', metaScope: 'm', cwd: '/p', scope: () => 'm' });
  const run = (execution: ToolExecution): Promise<ExecutableToolResult> => ('execute' in execution ? execution.execute({ turnId: 1, toolCallId: 'call', signal: new AbortController().signal }) : Promise.resolve(execution));
  const output = (result: ExecutableToolResult) => (typeof result.output === 'string' ? result.output : JSON.stringify(result.output));
  const planInput = (title: string, recommended?: boolean) => ({ title, basis: 'b', risk: 'r', prompt: 'p', fit: 'f', recommended });
  const angles = [{ title: 'top down', angle: 'start from the budget' }, { title: 'bottom up', angle: 'start from capacity' }];

  async function project() {
    const store = new ContinuoStoreService(new MemoryDocumentStore());
    await store.ensure('wd_1', '/p');
    await store.update('wd_1', (doc) => ({ ...doc, tasks: [task({ taskId: 't1', sessionId: 's_main' })], trajectories: [line({ trajectoryId: 'main', sessionId: 's_main', taskIds: ['t1'], turnCount: 1 })] }));
    const decisionOf = async () => (await store.load('wd_1'))!.decisions[0]!;
    return { store, main: new TrajectoryTool(store, sessionOf('s_main')), decisionOf };
  }

  async function exploring() {
    const ctx = await project();
    expect(await run(ctx.main.resolveExecution({ action: 'explore', question: 'Which basis?', angles, reason: 'each needs its own materials' }))).toMatchObject({ isError: false });
    await ctx.store.update('wd_1', (doc) => ({ ...doc, decisions: doc.decisions.map((decision) => ({ ...decision, exploration: { ...decision.exploration!, angles: decision.exploration!.angles.map((angle) => ({ ...angle, status: 'running' as const, sessionId: `s_${angle.key}` })) } })) }));
    return { ...ctx, authorA: new SubmitPlanTool(ctx.store, sessionOf('s_A')), authorB: new SubmitPlanTool(ctx.store, sessionOf('s_B')) };
  }

  it('stops the tool batch once a decision point is handed to the user', () => {
    expect(stopsBatch({ action: 'propose' })).toBe(true);
    expect(stopsBatch({ action: 'explore' })).toBe(true);
    expect(stopsBatch({ action: 'recommend' })).toBe(true);
    expect(stopsBatch({ action: 'expand', exhausted: { reason: 'r', ask: 'a' } })).toBe(true);
    expect(stopsBatch({ action: 'expand', plans: [planInput('x')] })).toBe(false);
  });

  it('numbers proposed plans A, B and continues with the next free letter on expand', async () => {
    const { main, decisionOf } = await project();
    const proposed = main.resolveExecution({ action: 'propose', question: 'Which basis?', plans: [planInput('grow', true), planInput('hold')], why: 'the guide asks for growth', dependsOn: 'appetite', name: 'Q4目标', category: 'review' });
    expect(proposed).toMatchObject({ stopBatchAfterThis: true });
    expect(output(await run(proposed))).toContain('End your turn now');
    const decision = await decisionOf();
    expect(decision.plans.map((plan) => plan.planId)).toEqual(['A', 'B']);
    expect(decision.plans[0]!.path).toMatch(/^work-log\/plan-.*-review-Q4目标-方案A\.md$/);
    expect(decision.plans[0]).not.toHaveProperty('recommended');
    expect(decision.stance).toMatchObject({ pick: 'A', dependsOn: 'appetite' });
    const expanded = main.resolveExecution({ action: 'expand', plans: [planInput('wait')] });
    expect(expanded).toMatchObject({ stopBatchAfterThis: false });
    expect(await run(expanded)).toMatchObject({ isError: false });
    expect((await decisionOf()).plans.map((plan) => plan.planId)).toEqual(['A', 'B', 'C']);
    const exhausted = main.resolveExecution({ action: 'expand', exhausted: { reason: 'covered', ask: 'growth or hold?' } });
    expect(exhausted).toMatchObject({ stopBatchAfterThis: true });
    expect(await run(exhausted)).toMatchObject({ isError: false });
    expect((await decisionOf()).exhausted).toMatchObject({ reason: 'covered' });
  });

  it('gives an author the plan id of its own key, whatever the order of submission', async () => {
    const { authorA, authorB, decisionOf, main } = await exploring();
    expect((await decisionOf()).exploration!.angles.map((angle) => [angle.key, angle.usage?.steps])).toEqual([['A', 0], ['B', 0]]);
    expect(output(await run(authorB.resolveExecution({ action: 'submit', plan: planInput('bottom up') })))).toContain('Submitted as plan B');
    expect(output(await run(authorA.resolveExecution({ action: 'ask', to: 'B', text: 'which file?' })))).toContain('B has already submitted plan B');
    expect(output(await run(authorA.resolveExecution({ action: 'submit', plan: planInput('top down') })))).toContain('Submitted as plan A');
    const decision = await decisionOf();
    expect(decision.plans.map((plan) => [plan.planId, plan.title])).toEqual([['B', 'bottom up'], ['A', 'top down']]);
    expect(decision.exploration!.angles.map((angle) => angle.planId)).toEqual(['A', 'B']);
    expect(decision.exploration!.messages).toEqual([{ from: 'A', to: 'B', text: 'which file?', at: expect.any(String) }]);
    expect(await run(main.resolveExecution({ action: 'expand', plans: [planInput('middle')] }))).toMatchObject({ isError: false });
    expect((await decisionOf()).plans.map((plan) => plan.planId)).toEqual(['B', 'A', 'C']);
  });

  it('reuses the letter of a withdrawn author when plans are added later', async () => {
    const { authorA, authorB, decisionOf, main } = await exploring();
    expect(await run(authorA.resolveExecution({ action: 'withdraw', sameAs: 'B', reason: 'same basis' }))).toMatchObject({ isError: false });
    expect(await run(authorB.resolveExecution({ action: 'submit', plan: planInput('bottom up') }))).toMatchObject({ isError: false });
    expect((await decisionOf()).exploration!.angles[0]).toMatchObject({ status: 'withdrawn', note: '和「bottom up」重复，same basis' });
    expect(await run(main.resolveExecution({ action: 'expand', plans: [planInput('middle')] }))).toMatchObject({ isError: false });
    expect((await decisionOf()).plans.map((plan) => plan.planId)).toEqual(['B', 'A']);
  });

  it('tells each role which tool is theirs', async () => {
    const { authorA, main, store } = await exploring();
    expect(output(await run(new TrajectoryTool(store, sessionOf('s_A')).resolveExecution({ action: 'propose', question: 'q', plans: [planInput('a'), planInput('b')], dependsOn: 'd' })))).toContain('SubmitPlan');
    expect(output(await run(new SubmitPlanTool(store, sessionOf('s_main')).resolveExecution({ action: 'submit', plan: planInput('a') })))).toContain('Trajectory');
    expect(await run(authorA.resolveExecution({ action: 'ask', to: 'Z', text: 'x' }))).toMatchObject({ isError: true });
    expect(await run(main.resolveExecution({ action: 'recommend', pick: 'Q', dependsOn: 'd' }))).toMatchObject({ isError: true });
  });
});

describe('unresolved items reported by the model', () => {
  it('keeps separate items separate even without end punctuation', () => {
    expect(joinFragments(['缺 Q3 数据', '预算未确认'])).toEqual(['缺 Q3 数据', '预算未确认']);
    expect(joinFragments(['missing Q3 figures', 'budget unconfirmed'])).toEqual(['missing Q3 figures', 'budget unconfirmed']);
  });

  it('rejoins an item the model split at a comma, a colon or inside a quote, and drops blanks', () => {
    expect(joinFragments(['缺 Q3 数据，', '待财务补齐。'])).toEqual(['缺 Q3 数据，待财务补齐。']);
    expect(joinFragments(['缺「', '预算表', '」里的口径'])).toEqual(['缺「预算表」里的口径']);
    expect(joinFragments(['missing:', 'the Q3 figures', ', from finance'])).toEqual(['missing: the Q3 figures, from finance']);
    expect(joinFragments([' ', '缺数据', ''])).toEqual(['缺数据']);
  });
});
