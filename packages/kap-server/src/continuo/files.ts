import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { currentTrajectory, lineRoot, type ContinuoWorkspaceDoc } from '@moonshot-ai/agent-core-v2';

import { ContinuoError } from './errors';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', '.kimi', '.continuo']);
const MAX_TEXT_BYTES = 256 * 1024;
const TEXT_EXTENSIONS = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|sh|sql|log|ini|cfg|conf|env|rst|tex)$/i;

export interface ContinuoFileEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly modifiedAt: string;
  readonly producedBy?: string;
  readonly isGuide: boolean;
  readonly childCount?: number;
}

export interface ContinuoFileListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly ContinuoFileEntry[];
}

export interface ContinuoFileContent {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly text?: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly producedBy?: string;
}

export function resolveInsideRoot(root: string, relPath: string): string {
  const abs = resolve(root, relPath === '' ? '.' : relPath);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new ContinuoError('invalid_state', `${relPath} 不在这个项目里。`);
  return abs;
}

function viewRoot(doc: ContinuoWorkspaceDoc): string {
  return lineRoot(doc, currentTrajectory(doc));
}

export function producedByIndex(doc: ContinuoWorkspaceDoc): Map<string, string> {
  const index = new Map<string, string>();
  const line = currentTrajectory(doc);
  const own = line === undefined ? undefined : new Set(line.taskIds);
  for (const task of doc.tasks) {
    if (own !== undefined && task.kind === 'user' && !own.has(task.taskId)) continue;
    for (const item of task.report?.deliverables ?? []) {
      if (item.exists === false) continue;
      index.set(normalize(item.path), task.taskId);
    }
  }
  return index;
}

function normalize(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export async function listFiles(doc: ContinuoWorkspaceDoc, relPath: string): Promise<ContinuoFileListing> {
  const root = viewRoot(doc);
  const dir = resolveInsideRoot(root, relPath);
  const rel = normalize(relative(root, dir));
  const produced = producedByIndex(doc);
  const guideFiles = new Set((doc.scan?.guideFiles ?? []).map(normalize));
  let names: import('node:fs').Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new ContinuoError('entry_not_found', `找不到文件夹 ${relPath}。`);
  }
  const entries: ContinuoFileEntry[] = [];
  for (const dirent of names) {
    if (SKIP_DIRS.has(dirent.name) || dirent.name.startsWith('.')) continue;
    const abs = join(dir, dirent.name);
    const entryRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
    let info: Awaited<ReturnType<typeof stat>>;
    try { info = await stat(abs); } catch { continue; }
    if (dirent.isDirectory()) {
      let childCount = 0;
      try { childCount = (await readdir(abs)).filter((name) => !name.startsWith('.') && !SKIP_DIRS.has(name)).length; } catch { childCount = 0; }
      entries.push({ name: dirent.name, path: entryRel, kind: 'dir', size: 0, modifiedAt: info.mtime.toISOString(), isGuide: false, childCount });
    } else if (dirent.isFile()) {
      entries.push({ name: dirent.name, path: entryRel, kind: 'file', size: info.size, modifiedAt: info.mtime.toISOString(), producedBy: produced.get(entryRel), isGuide: guideFiles.has(entryRel) });
    }
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  const parent = rel === '' ? null : normalize(relative(root, resolve(dir, '..')));
  return { path: rel, parent, entries };
}

export async function readTextFile(doc: ContinuoWorkspaceDoc, relPath: string): Promise<ContinuoFileContent> {
  const root = viewRoot(doc);
  const abs = resolveInsideRoot(root, relPath);
  let info: Awaited<ReturnType<typeof stat>>;
  try { info = await stat(abs); } catch { throw new ContinuoError('entry_not_found', `找不到文件 ${relPath}。`); }
  if (!info.isFile()) throw new ContinuoError('invalid_state', `${relPath} 不是文件。`);
  const rel = normalize(relative(root, abs));
  const producedBy = producedByIndex(doc).get(rel);
  const base = { path: rel, size: info.size, modifiedAt: info.mtime.toISOString(), producedBy };
  if (!TEXT_EXTENSIONS.test(abs)) return { ...base, binary: true, truncated: false };
  const buffer = await readFile(abs);
  const slice = buffer.subarray(0, MAX_TEXT_BYTES);
  if (slice.includes(0)) return { ...base, binary: true, truncated: false };
  return { ...base, text: slice.toString('utf8'), truncated: buffer.length > MAX_TEXT_BYTES, binary: false };
}
