import { describe, expect, it } from 'vitest';

import type { IDisposable } from '#/_base/di/lifecycle';
import { compileContextBundle, CONTEXT_BUNDLE_MAX_CHARS } from '#/features/continuo/contextBundle';
import { ContinuoStoreService } from '#/features/continuo/store';
import { inheritedChoices, planPath, planStatusOn, tasksThrough } from '#/features/continuo/trajectory';
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
    const text = compileContextBundle(doc, task())!.text;
    expect(text).toContain('Following plan A: grow 10%. Basis: basis A Risk: risk A');
    expect(text).toContain('Plan B: keep budget — not taken. work-log/plan-B.md');
    expect(text).not.toContain('basis B');
  });

  it('marks a decision that is still open so the agent waits for the user', () => {
    const main = line({ trajectoryId: 'main', taskIds: ['task_1'] });
    const doc = { ...docWith([], { understanding: { text: 'Q4 planning', sourceRefs: [], updatedAt: NOW } }), trajectories: [main], decisions: [decision()] };
    expect(compileContextBundle(doc, task())!.text).toContain('Still open: wait for the user');
  });
});

describe('compileContextBundle', () => {
  it('returns nothing when the folder has neither an understanding nor any points', () => {
    expect(compileContextBundle(docWith([]), task())).toBeUndefined();
  });

  it('injects the understanding, the points with their sources and the current task', () => {
    const doc = docWith([
      entry({ id: 'conv', text: 'deliverables go in drafts/', sourceRefs: ['README.md'] }),
      entry({ id: 'bg', text: 'materials/ is read-only', sourceRefs: ['AGENTS.md'] }),
    ], { understanding: { text: 'A folder for the Q2 review.', sourceRefs: ['README.md'], updatedAt: NOW } });
    const bundle = compileContextBundle(doc, task({ supplements: ['keep it under 150 words'] }));
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
    expect(compileContextBundle(doc, task())!.text).toContain('work-log/');
  });

  it('stays within the character budget', () => {
    const filler = Array.from({ length: 40 }, (_, index) => entry({ id: `m${index}`, text: 'm'.repeat(400) }));
    const bundle = compileContextBundle(docWith(filler), task())!;
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

  it('ignores stored documents from another schema version', async () => {
    const documents = new MemoryDocumentStore();
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_old', { ...newWorkspaceDoc('wd_old', '/tmp/old'), schemaVersion: 2 });
    const store = new ContinuoStoreService(documents);
    expect(await store.load('wd_old')).toBeUndefined();
    const fresh = await store.ensure('wd_old', '/tmp/old');
    expect(fresh.schemaVersion).toBe(3);
  });
});
