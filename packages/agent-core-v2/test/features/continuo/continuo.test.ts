import { describe, expect, it } from 'vitest';

import type { IDisposable } from '#/_base/di/lifecycle';
import { compileContextBundle, CONTEXT_BUNDLE_MAX_CHARS } from '#/features/continuo/contextBundle';
import { ContinuoStoreService } from '#/features/continuo/store';
import { buildTrajectoryExport } from '#/features/continuo/export';
import { migrateWorkspaceDoc } from '#/features/continuo/migrate';
import { doneOnLine, guardAccesses, guardTool, inheritedChoices, otherLineNote, planPath, planStatusOn, tasksThrough } from '#/features/continuo/trajectory';
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
    contextRevision: 1,
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
    const text = bundleFor(doc, task())!.text;
    expect(text).toContain('Following plan A: grow 10%. Basis: basis A Risk: risk A');
    expect(text).toContain('Plan B: keep budget — not taken. work-log/plan-B.md');
    expect(text).not.toContain('basis B');
  });

  it('marks a decision that is still open so the agent waits for the user', () => {
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'] });
    const doc = { ...docWith([], { understanding: { text: 'Q4 planning', sourceRefs: [], updatedAt: NOW } }), trajectories: [main], decisions: [decision()] };
    expect(bundleFor(doc, task())!.text).toContain('Still open: wait for the user');
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
    const bundle = bundleFor(doc, task({ supplements: ['keep it under 150 words'] }));
    expect(bundle).toBeDefined();
    expect(bundle!.revision).toBe(7);
    expect(bundle!.entryIds).toEqual(['conv', 'bg']);
    const text = bundle!.text;
    expect(text).toContain('A folder for the Q2 review.');
    expect(text).toContain('- deliverables go in drafts/ (source: README.md)');
    expect(text).toContain('Current task: write the Q2 review');
    expect(text).toContain('The user added: keep it under 150 words');
  });

  it('points the agent at the folder and its work logs instead of a remembered ledger', () => {
    const doc = docWith([], { understanding: { text: 'Q2 review folder', sourceRefs: [], updatedAt: NOW } });
    expect(bundleFor(doc, task())!.text).toContain('work-log/');
  });

  it('stays within the character budget', () => {
    const filler = Array.from({ length: 40 }, (_, index) => entry({ id: `m${index}`, text: 'm'.repeat(400) }));
    const bundle = bundleFor(docWith(filler), task())!;
    expect(bundle.entryIds.length).toBeLessThanOrEqual(30);
    expect(bundle.text.length).toBeLessThanOrEqual(CONTEXT_BUNDLE_MAX_CHARS + 600);
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
      const bundle = compileContextBundle({ ...forked, understanding: { text: 'u', sourceRefs: [], updatedAt: NOW } }, 's_c')!.text;
      expect(bundle).toContain('Other lines of this project work in this same folder.');
      expect(bundle).toContain('drafts/b.md');
      expect(bundle).not.toContain('drafts/c.md,');
      expect(bundle).toContain('"-方案C"');
      expect(bundle).toContain('notes-方案C.md');
    });
  });

  it('lets a plan author read but never write', () => {
    const exploring = { ...decision(), plans: [], exploration: { reason: 'r', angles: [{ key: 'A', title: 'a', angle: 'look at x', status: 'running' as const, sessionId: 's_author', steps: 0 }], messages: [], maxSteps: 8, startedAt: NOW } };
    const withAuthor = { ...doc, decisions: [exploring] };
    expect(guard(withAuthor, 's_author', [{ operation: 'read', path: '/p/materials/a.md' }])).toBeUndefined();
    expect(guard(withAuthor, 's_author', [{ operation: 'write', path: '/p/drafts/a.md' }])).toContain('Trajectory submit');
    expect(guardTool(withAuthor, 's_author', 'Bash', '/p')).toContain('Read, Grep and Glob');
    expect(guardTool(withAuthor, 's_author', 'AskUserQuestion', undefined)).toContain('Trajectory ask');
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
    const text = bundleFor(doc, task())!.text;
    expect(text).toContain('Done on this line');
    expect(text).toContain('- 复盘 → drafts/r.md');
    expect(text).toContain('Plan B: keep budget — followed on another line: 1 task, 2 rounds, produced drafts/b.md.');
  });

  it('tells a branched line where its directory is', () => {
    const b = line({ trajectoryId: 'b', workDir: '/tmp/ws/.continuo/lines/b' });
    const doc = { ...docWith([], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), trajectories: [b] };
    expect(bundleFor(doc, task())!.text).toContain('Working directory of this line: /tmp/ws/.continuo/lines/b');
  });

  it('briefs a plan author on its angle, the other authors and its messages only', () => {
    const exploring = { ...decision(), plans: [], exploration: { reason: 'r', angles: [
      { key: 'A', title: 'top down', angle: 'start from the budget', status: 'running' as const, sessionId: 's_a', steps: 0 },
      { key: 'B', title: 'bottom up', angle: 'start from delivery capacity', status: 'running' as const, sessionId: 's_b', steps: 0 },
    ], messages: [{ from: 'B', to: 'A', text: 'which budget file?', at: NOW }, { from: 'A', to: 'B', text: 'budget-2026.md', at: NOW }], maxSteps: 8, startedAt: NOW } };
    const doc = { ...docWith([], { understanding: { text: 'Q4', sourceRefs: [], updatedAt: NOW } }), trajectories: [line({ trajectoryId: 'main', taskIds: ['task_1'] })], tasks: [task()], decisions: [exploring] };
    const text = compileContextBundle(doc, 's_a')!.text;
    expect(text).toContain('You are the author of plan A');
    expect(text).toContain('Your angle: top down — start from the budget');
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
});
