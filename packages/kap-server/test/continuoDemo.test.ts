import { describe, expect, it } from 'vitest';

import { DEMO_FILES, seedDemoDoc } from '../src/continuo/demoWorkspace';

describe('seeded demo workspace', () => {
  const doc = seedDemoDoc('wd_demo', '/tmp/demo');

  it('opens already understood with a finished prior task', () => {
    expect(doc.init.status).toBe('completed');
    expect(doc.understanding?.text.length).toBeGreaterThan(0);
    const prior = doc.tasks.filter((task) => task.kind === 'user');
    expect(prior).toHaveLength(1);
    expect(prior[0]!.status).toBe('completed');
    expect(prior[0]!.sessionId).toBe('');
    expect(prior[0]!.reuse).toEqual({ entries: 4, questions: 0 });
  });

  it('ships the files its ledger refers to', () => {
    for (const task of doc.tasks) {
      for (const item of task.report?.deliverables ?? []) expect(DEMO_FILES).toHaveProperty(item.path);
    }
    for (const entry of doc.context) {
      for (const ref of entry.sourceRefs.filter((ref) => !ref.includes(':'))) expect(DEMO_FILES).toHaveProperty(ref);
    }
  });

  it('links every task-created entry to a seeded task', () => {
    const ids = new Set(doc.tasks.map((task) => task.taskId));
    for (const entry of doc.context) if (entry.taskId !== undefined) expect(ids.has(entry.taskId)).toBe(true);
    expect(doc.context.some((entry) => entry.kind === 'decision' && entry.origin === 'user')).toBe(true);
  });
});
