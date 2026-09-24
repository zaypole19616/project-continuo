import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_USAGE, type ContinuoTask } from '@moonshot-ai/agent-core-v2';

import { interruptedOnRestart, isBusy, isLiveBusy, started, toAwaiting, toEnded, toRunning } from '../src/continuo/taskState';
import { TodoRunner } from '../src/continuo/todos';

const NOW = '2026-09-24T00:00:00.000Z';
const LATER = '2026-09-24T00:05:00.000Z';

function task(overrides: Partial<ContinuoTask> = {}): ContinuoTask {
  return { taskId: 'task_1', kind: 'user', title: 'write the review', trigger: 'user', sessionId: 'session_1', promptIds: ['msg_1'], status: 'running', pauseRequested: false, usage: EMPTY_USAGE, createdAt: NOW, updatedAt: NOW, ...overrides };
}

describe('isBusy', () => {
  it('counts a task that is queued, running or checking its deliverables as busy', () => {
    expect(isBusy(task({ status: 'queued' }))).toBe(true);
    expect(isBusy(task({ status: 'running' }))).toBe(true);
    expect(isBusy(task({ status: 'verifying' }))).toBe(true);
  });

  it('counts a task waiting for an answer or an approval as busy, but not one waiting for a reply or a choice', () => {
    expect(isBusy(task({ status: 'awaiting_user', pendingInteraction: 'question' }))).toBe(true);
    expect(isBusy(task({ status: 'awaiting_user', pendingInteraction: 'approval' }))).toBe(true);
    expect(isBusy(task({ status: 'awaiting_user', pendingInteraction: 'reply' }))).toBe(false);
    expect(isBusy(task({ status: 'awaiting_user', pendingInteraction: 'choice' }))).toBe(false);
  });

  it('counts finished and stopped tasks as idle', () => {
    for (const status of ['completed', 'needs_review', 'paused', 'failed', 'interrupted'] as const) expect(isBusy(task({ status }))).toBe(false);
  });

  it('only lets a busy task with a live attachment block the project', () => {
    expect(isLiveBusy(task(), new Set(['task_1']))).toBe(true);
    expect(isLiveBusy(task(), new Set())).toBe(false);
    expect(isLiveBusy(task({ status: 'completed' }), new Set(['task_1']))).toBe(false);
  });
});

describe('task transitions', () => {
  it('starts a queued task with its first prompt and nothing else', () => {
    const after = started(task({ status: 'queued', promptIds: [] }), 'msg_2');
    expect(after).toMatchObject({ status: 'running', promptIds: ['msg_2'], trigger: 'user' });
  });

  it('brings a task back to running with one reset rule, whatever it was doing before', () => {
    const before = task({ status: 'failed', phase: '在写 report.md', pendingInteraction: 'question', pauseRequested: true, endedAt: NOW, verification: ['unresolved: x'], error: { code: 'turn.failed', message: 'boom', at: NOW } });
    const after = toRunning(before, { promptId: 'msg_2', trigger: 'resume' });
    expect(after).toMatchObject({ status: 'running', trigger: 'resume', pendingInteraction: 'none', pauseRequested: false, promptIds: ['msg_1', 'msg_2'] });
    expect(after.phase).toBeUndefined();
    expect(after.endedAt).toBeUndefined();
    expect(after.verification).toBeUndefined();
    expect(after.error).toBeUndefined();
    expect(after.supplements).toBeUndefined();
  });

  it('keeps the trigger unless the restart names one, and files a reply as a supplement', () => {
    const more = toRunning(task({ trigger: 'plan', status: 'awaiting_user', pendingInteraction: 'choice' }), { promptId: 'msg_2', phase: '在比较方案' });
    expect(more).toMatchObject({ trigger: 'plan', phase: '在比较方案', status: 'running' });
    const replied = toRunning(task({ status: 'completed', supplements: ['first'] }), { promptId: 'msg_3', trigger: 'reply', supplement: 'second' });
    expect(replied).toMatchObject({ trigger: 'reply', supplements: ['first', 'second'] });
  });

  it('hands a task to the user with the interaction it waits for', () => {
    expect(toAwaiting(task({ phase: '在读 a.md' }), 'choice', '等你选方案')).toMatchObject({ status: 'awaiting_user', pendingInteraction: 'choice', phase: '等你选方案' });
  });

  it('ends a task and drops what only a running task carries', () => {
    const after = toEnded(task({ phase: '在读 a.md', pendingInteraction: 'approval' }), 'paused', LATER);
    expect(after).toMatchObject({ status: 'paused', pendingInteraction: 'none', endedAt: LATER });
    expect(after.phase).toBeUndefined();
  });

  it('marks a busy task interrupted after a restart and leaves the others alone', () => {
    const dead = interruptedOnRestart(task({ status: 'awaiting_user', pendingInteraction: 'approval' }), LATER);
    expect(dead).toMatchObject({ status: 'interrupted', pendingInteraction: 'none', endedAt: LATER, error: { code: 'turn.failed', message: '服务重启时这件事还在进行', at: LATER } });
    const settled = task({ status: 'completed', endedAt: NOW });
    expect(interruptedOnRestart(settled, LATER)).toBe(settled);
    const waiting = task({ status: 'awaiting_user', pendingInteraction: 'reply' });
    expect(interruptedOnRestart(waiting, LATER)).toBe(waiting);
  });
});

describe('TodoRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks on its interval until disposed, and a second start does not double it', async () => {
    const tick = vi.fn(async () => undefined);
    const runner = new TodoRunner(tick, 1000);
    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(tick).toHaveBeenCalledTimes(2);
    runner.dispose();
    runner.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('keeps ticking after a tick fails', async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const runner = new TodoRunner(tick, 1000);
    runner.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(2);
    runner.dispose();
  });
});
