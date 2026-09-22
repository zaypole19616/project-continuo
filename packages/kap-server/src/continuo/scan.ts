import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import type { ScanEntry, WorkspaceScan } from '@moonshot-ai/agent-core-v2';

export const SCAN_MAX_ENTRIES = 2000;
export const SCAN_MAX_DEPTH = 5;

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', '.turbo', '.pnpm-store', 'target', '.idea', '.vscode']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const CREDENTIAL_PATTERN = /(^\.env(\..*)?$|\.pem$|\.key$|^id_(rsa|ed25519)|\.p12$|\.pfx$|credentials|secret)/i;
const GUIDE_PATTERN = /^(readme(\..*)?|agents\.md|claude\.md|index\.md|directories\.md|skills\.md)$/i;

export async function scanWorkspace(root: string): Promise<WorkspaceScan> {
  const entries: ScanEntry[] = [];
  const guideFiles: string[] = [];
  const unscanned: string[] = [];
  const byExt: Record<string, number> = {};
  let dirs = 0;
  let files = 0;
  let truncated = false;
  const queue: Array<{ abs: string; depth: number }> = [{ abs: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (entries.length >= SCAN_MAX_ENTRIES) {
      truncated = true;
      unscanned.push(relative(root, current.abs) || '.');
      continue;
    }
    let names: string[];
    try {
      names = (await readdir(current.abs)).toSorted();
    } catch {
      unscanned.push(relative(root, current.abs) || '.');
      continue;
    }
    for (const name of names) {
      if (entries.length >= SCAN_MAX_ENTRIES) { truncated = true; break; }
      if (SKIP_FILES.has(name)) continue;
      const abs = join(current.abs, name);
      const rel = relative(root, abs);
      let info;
      try { info = await stat(abs); } catch { continue; }
      if (info.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) { unscanned.push(rel); continue; }
        dirs += 1;
        entries.push({ path: rel, kind: 'dir' });
        if (current.depth + 1 < SCAN_MAX_DEPTH) queue.push({ abs, depth: current.depth + 1 });
        else { truncated = true; unscanned.push(rel); }
        continue;
      }
      if (!info.isFile()) continue;
      if (CREDENTIAL_PATTERN.test(name)) { entries.push({ path: rel, kind: 'file', size: info.size, ext: 'credential' }); continue; }
      files += 1;
      const ext = extname(name).toLowerCase() || '(none)';
      byExt[ext] = (byExt[ext] ?? 0) + 1;
      entries.push({ path: rel, kind: 'file', size: info.size, ext });
      if (GUIDE_PATTERN.test(name) && current.depth <= 1) guideFiles.push(rel);
    }
  }
  return { scannedAt: new Date().toISOString(), entries, guideFiles, truncated, unscanned, counts: { dirs, files, byExt } };
}

export function renderScanForPrompt(scan: WorkspaceScan, root: string): string {
  const lines: string[] = [];
  lines.push(`Workspace root: ${root}`);
  lines.push(`Structure scan: ${scan.counts.dirs} folders, ${scan.counts.files} files${scan.truncated ? ' (scan truncated; not everything is listed)' : ''}.`);
  const exts = Object.entries(scan.counts.byExt).toSorted((a, b) => b[1] - a[1]).slice(0, 12).map(([ext, count]) => `${ext} ×${count}`);
  if (exts.length > 0) lines.push(`File types: ${exts.join(', ')}.`);
  if (scan.guideFiles.length > 0) lines.push(`Guide files found (read these first): ${scan.guideFiles.join(', ')}`);
  else lines.push('No guide files (README, AGENTS.md, CLAUDE.md) were found at the top levels.');
  if (scan.unscanned.length > 0) lines.push(`Not scanned (skipped or beyond depth): ${scan.unscanned.slice(0, 20).join(', ')}${scan.unscanned.length > 20 ? ', …' : ''}`);
  const tree = scan.entries.filter((entry) => entry.path.split('/').length <= 2).slice(0, 150).map((entry) => `${entry.kind === 'dir' ? '[dir] ' : ''}${entry.path}${entry.ext === 'credential' ? ' (credential-like, do not read)' : ''}`);
  lines.push('Top two levels:');
  lines.push(...tree.map((line) => `  ${line}`));
  if (scan.entries.length === 0) lines.push('  (empty folder)');
  return lines.join('\n');
}
