import { describe, expect, it } from 'vitest';

import type { IDisposable } from '#/_base/di/lifecycle';
import { compileContextBundle, CONTEXT_BUNDLE_MAX_CHARS } from '#/features/continuo/contextBundle';
import { ContinuoStoreService } from '#/features/continuo/store';
import {
  CONTINUO_STORE_SCOPE,
  EMPTY_USAGE,
  isEffectiveEntry,
  newWorkspaceDoc,
  type ContextEntry,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
} from '#/features/continuo/types';
import type { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

const NOW = '2026-09-20T00:00:00.000Z';

function entry(overrides: Partial<ContextEntry> & { id: string; text: string }): ContextEntry {
  return {
    kind: 'background',
    scope: { type: 'workspace' },
    sourceRefs: [],
    origin: 'agent',
    status: 'active',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
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

describe('isEffectiveEntry', () => {
  it('keeps only active entries and task-scoped entries of the current task', () => {
    expect(isEffectiveEntry(entry({ id: 'a', text: 'x' }), undefined)).toBe(true);
    expect(isEffectiveEntry(entry({ id: 'b', text: 'x', status: 'candidate' }), undefined)).toBe(false);
    expect(isEffectiveEntry(entry({ id: 'c', text: 'x', status: 'stale' }), 'task_1')).toBe(false);
    expect(isEffectiveEntry(entry({ id: 'd', text: 'x', scope: { type: 'task', taskId: 'task_1' } }), 'task_1')).toBe(true);
    expect(isEffectiveEntry(entry({ id: 'e', text: 'x', scope: { type: 'task', taskId: 'task_1' } }), 'task_2')).toBe(false);
  });
});

describe('compileContextBundle', () => {
  it('returns nothing when there is neither understanding nor effective context', () => {
    expect(compileContextBundle(docWith([entry({ id: 'a', text: 'x', status: 'candidate' })]), task())).toBeUndefined();
  });

  it('injects only effective entries, decisions and conventions first, and names the current task', () => {
    const doc = docWith([
      entry({ id: 'bg', text: 'background fact', kind: 'background' }),
      entry({ id: 'cand', text: 'unconfirmed guess', status: 'candidate' }),
      entry({ id: 'conv', text: 'deliverables go in drafts/', kind: 'convention', origin: 'file', sourceRefs: ['README.md'] }),
      entry({ id: 'dec', text: 'only three topics', kind: 'decision', origin: 'user' }),
      entry({ id: 'other', text: 'belongs to another task', scope: { type: 'task', taskId: 'task_9' } }),
      entry({ id: 'old', text: 'superseded wording', status: 'superseded' }),
    ], { understanding: { text: 'A folder for the Q2 review.', sourceRefs: ['README.md'], updatedAt: NOW } });
    const bundle = compileContextBundle(doc, task());
    expect(bundle).toBeDefined();
    expect(bundle!.revision).toBe(7);
    expect(bundle!.entryIds).toEqual(['dec', 'conv', 'bg']);
    const text = bundle!.text;
    expect(text).toContain('A folder for the Q2 review.');
    expect(text.indexOf('only three topics')).toBeLessThan(text.indexOf('deliverables go in drafts/'));
    expect(text.indexOf('deliverables go in drafts/')).toBeLessThan(text.indexOf('background fact'));
    expect(text).toContain('[confirmed by user]');
    expect(text).toContain('(source: README.md) [from files]');
    expect(text).not.toContain('unconfirmed guess');
    expect(text).not.toContain('belongs to another task');
    expect(text).not.toContain('superseded wording');
    expect(text).toContain('Current task: write the Q2 review');
  });

  it('flags stale entries separately so the agent re-checks their sources', () => {
    const doc = docWith([entry({ id: 's', text: 'numbers from the old export', status: 'stale', sourceRefs: ['materials/q2.md'] })], {
      understanding: { text: 'Q2 review folder', sourceRefs: [], updatedAt: NOW },
    });
    const text = compileContextBundle(doc, task())!.text;
    expect(text).toContain('source files changed');
    expect(text).toContain('numbers from the old export (source: materials/q2.md)');
    expect(text).not.toContain('- Project background: numbers from the old export');
  });

  it('stays within the character budget while never dropping decisions or conventions', () => {
    const filler = Array.from({ length: 40 }, (_, index) => entry({ id: `m${index}`, kind: 'material', text: 'm'.repeat(400), updatedAt: `2026-09-20T00:00:${String(index).padStart(2, '0')}.000Z` }));
    const doc = docWith([...filler, entry({ id: 'dec', kind: 'decision', text: 'd'.repeat(500), updatedAt: '2026-09-21T00:00:00.000Z' })]);
    const bundle = compileContextBundle(doc, task())!;
    expect(bundle.entryIds).toContain('dec');
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

  it('caps the activity log and notifies listeners', async () => {
    const store = new ContinuoStoreService(new MemoryDocumentStore());
    await store.ensure('wd_1', '/tmp/ws');
    const seen: number[] = [];
    const off = store.onDidChange((doc) => { seen.push(doc.revision); });
    const many = Array.from({ length: 450 }, (_, index) => ({ at: NOW, kind: 'tool' as const, text: `step ${index}` }));
    const doc = await store.update('wd_1', (current) => ({ ...current, activity: many }));
    expect(doc.activity).toHaveLength(400);
    expect(doc.activity[0]?.text).toBe('step 50');
    off();
    await store.log('wd_1', { kind: 'system', text: 'after unsubscribe' });
    expect(seen).toEqual([2]);
  });

  it('ignores stored documents from another schema version', async () => {
    const documents = new MemoryDocumentStore();
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_old', { ...newWorkspaceDoc('wd_old', '/tmp/old'), schemaVersion: 0 });
    const store = new ContinuoStoreService(documents);
    expect(await store.load('wd_old')).toBeUndefined();
    const fresh = await store.ensure('wd_old', '/tmp/old');
    expect(fresh.schemaVersion).toBe(1);
  });
});
