import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { CONTINUO_DIR, LINES_DIR } from '@moonshot-ai/agent-core-v2';

const run = promisify(execFile);

interface Repo {
  readonly gitDir: string;
  readonly workTree: string;
  readonly ours: boolean;
}

const IDENTITY = { GIT_AUTHOR_NAME: 'Continuo', GIT_AUTHOR_EMAIL: 'continuo@localhost', GIT_COMMITTER_NAME: 'Continuo', GIT_COMMITTER_EMAIL: 'continuo@localhost' };
const WALK_SKIP = new Set(['.continuo', '.git', 'node_modules', '.venv', '__pycache__']);
const EMPTY_PREFIX = 'empty: ';
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(projectRoot);
  const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export function linesSettled(projectRoot: string): Promise<unknown> {
  return queues.get(resolve(projectRoot)) ?? Promise.resolve();
}

async function git(repo: Repo, args: readonly string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run('git', ['--git-dir', repo.gitDir, '--work-tree', repo.workTree, ...args], { cwd: repo.workTree, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function repoAt(dir: string, ours: boolean): Promise<Repo | undefined> {
  try {
    const { stdout: top } = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    if (await realpath(top.trim()) !== await realpath(dir)) return undefined;
    const { stdout: gitDir } = await run('git', ['-C', dir, 'rev-parse', '--absolute-git-dir']);
    return { gitDir: gitDir.trim(), workTree: dir, ours };
  } catch {
    return undefined;
  }
}

async function hideContinuoDir(projectRoot: string): Promise<void> {
  const marker = join(projectRoot, CONTINUO_DIR, '.gitignore');
  if (existsSync(marker)) return;
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, '*\n', 'utf8');
}

async function emptyDirs(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (found.length >= 500 || depth > 12) return;
    const entries = (await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.name !== '.DS_Store');
    if (entries.length === 0 && rel !== '') {
      found.push(rel);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !WALK_SKIP.has(entry.name)) await walk(rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1);
    }
  };
  await walk('', 0);
  return found;
}

export function snapshotDir(projectRoot: string, dir: string, label: string): Promise<string | undefined> {
  return serialized(projectRoot, async () => {
    const repo = await repoAt(dir, resolve(dir) !== resolve(projectRoot));
    if (repo === undefined) return undefined;
    try {
      await hideContinuoDir(projectRoot);
      const index = join(repo.gitDir, `continuo-index-${randomUUID().slice(0, 8)}`);
      const seed = join(repo.gitDir, 'index');
      try {
        if (existsSync(seed)) await copyFile(seed, index);
        await git(repo, ['add', '--all', '--', '.'], { GIT_INDEX_FILE: index });
        const tree = await git(repo, ['write-tree'], { GIT_INDEX_FILE: index });
        const empty = await emptyDirs(dir);
        const message = [`continuo ${label}`, ...(empty.length === 0 ? [] : ['', ...empty.map((rel) => `${EMPTY_PREFIX}${rel}`)])].join('\n');
        const commit = await git(repo, ['commit-tree', tree, '-m', message], IDENTITY);
        await git(repo, ['update-ref', `refs/continuo/${label}`, commit]);
        if (repo.ours) await rename(index, seed);
        return commit;
      } finally {
        await rm(index, { force: true });
      }
    } catch {
      return undefined;
    }
  });
}

export function createLineDir(projectRoot: string, commit: string, trajectoryId: string): Promise<string | undefined> {
  return serialized(projectRoot, async () => {
    const repo = await repoAt(projectRoot, false);
    if (repo === undefined) return undefined;
    try {
      const dir = join(projectRoot, LINES_DIR, trajectoryId);
      await mkdir(dirname(dir), { recursive: true });
      await run('git', ['--git-dir', repo.gitDir, 'worktree', 'add', '--detach', '--force', dir, commit], { cwd: projectRoot, env: { ...process.env, ...IDENTITY } });
      const { stdout } = await run('git', ['--git-dir', repo.gitDir, 'log', '-1', '--format=%B', commit]);
      for (const line of stdout.split('\n')) {
        const rel = line.startsWith(EMPTY_PREFIX) ? line.slice(EMPTY_PREFIX.length) : '';
        if (rel !== '' && !rel.split('/').includes('..')) await mkdir(join(dir, rel), { recursive: true });
      }
      return dir;
    } catch {
      return undefined;
    }
  });
}
