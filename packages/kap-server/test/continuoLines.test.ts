import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLineDir, snapshotDir } from '../src/continuo/lines';

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuo-lines-'));
  roots.push(root);
  writeFileSync(join(root, 'notes.md'), 'draft one\n');
  return root;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' } }).trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('continuo line directories', () => {
  it('copies a plain folder into a line directory that changes independently', async () => {
    const root = project();
    mkdirSync(join(root, 'drafts', 'empty'), { recursive: true });
    const commit = await snapshotDir(root, root, 'decision/dec_1');
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(root, 'notes.md'), 'main line edit\n');
    const dir = await createLineDir(root, commit!, 'trj_b');
    expect(dir).toBe(join(root, '.continuo', 'lines', 'trj_b'));
    expect(readFileSync(join(dir!, 'notes.md'), 'utf8')).toBe('draft one\n');
    writeFileSync(join(dir!, 'notes.md'), 'branch edit\n');
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('main line edit\n');
    expect(existsSync(join(dir!, '.continuo'))).toBe(false);
    expect(existsSync(join(dir!, 'drafts', 'empty'))).toBe(true);
    expect(readFileSync(join(root, '.continuo', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('forks a line directory from a snapshot of another line directory', async () => {
    const root = project();
    const first = await createLineDir(root, (await snapshotDir(root, root, 'task/t1'))!, 'trj_b');
    writeFileSync(join(first!, 'plan-b.md'), 'only on b\n');
    const commit = await snapshotDir(root, first!, 'task/t2');
    const second = await createLineDir(root, commit!, 'trj_c');
    expect(readFileSync(join(second!, 'plan-b.md'), 'utf8')).toBe('only on b\n');
    expect(existsSync(join(root, 'plan-b.md'))).toBe(false);
  });

  it('leaves the index and branches of a git project untouched', async () => {
    const root = project();
    git(root, 'init', '--quiet');
    git(root, 'add', 'notes.md');
    git(root, 'commit', '--quiet', '-m', 'init');
    writeFileSync(join(root, 'draft.md'), 'untracked work\n');
    const statusBefore = git(root, 'status', '--porcelain');
    const commit = await snapshotDir(root, root, 'task/t1');
    const dir = await createLineDir(root, commit!, 'trj_b');
    expect(git(root, 'status', '--porcelain')).toBe(statusBefore);
    expect(git(root, 'branch', '--list')).toBe(`* ${git(root, 'branch', '--show-current')}`);
    expect(readFileSync(join(dir!, 'draft.md'), 'utf8')).toBe('untracked work\n');
    expect(git(root, 'rev-parse', 'refs/continuo/task/t1')).toBe(commit);
  });

  it('reports no snapshot when the folder cannot be snapshotted', async () => {
    expect(await snapshotDir(join(tmpdir(), 'continuo-missing-folder'), join(tmpdir(), 'continuo-missing-folder', 'x'), 'task/t1')).toBeUndefined();
  });
});
