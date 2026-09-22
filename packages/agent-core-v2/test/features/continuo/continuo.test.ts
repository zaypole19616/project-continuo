import { describe, expect, it } from 'vitest';

import type { IDisposable } from '#/_base/di/lifecycle';
import { compileContextBundle, CONTEXT_BUNDLE_MAX_CHARS } from '#/features/continuo/contextBundle';
import { ContinuoStoreService } from '#/features/continuo/store';
import {
  CONTINUO_STORE_SCOPE,
  EMPTY_USAGE,
  newWorkspaceDoc,
  type ContextEntry,
  type ContinuoTask,
  type ContinuoWorkspaceDoc,
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
    await documents.set(CONTINUO_STORE_SCOPE, 'wd_old', { ...newWorkspaceDoc('wd_old', '/tmp/old'), schemaVersion: 1 });
    const store = new ContinuoStoreService(documents);
    expect(await store.load('wd_old')).toBeUndefined();
    const fresh = await store.ensure('wd_old', '/tmp/old');
    expect(fresh.schemaVersion).toBe(2);
  });
});
