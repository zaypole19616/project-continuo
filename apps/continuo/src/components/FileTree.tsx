import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { continuoFiles, type FileEntry } from '#/lib/api';
import type { NavTarget } from './FileBrowser';
import { FolderGlyph } from './icons';

export function FileTree({ workspaceId, rootName, revision, target, onNavigate }: { workspaceId: string; rootName: string; revision: number; target: NavTarget; onNavigate: (t: NavTarget) => void }) {
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ '': true });

  const load = (path: string) => continuoFiles.list(workspaceId, path).then((r) => setChildren((prev) => ({ ...prev, [path]: r.entries }))).catch(() => undefined);

  useEffect(() => { if (revision > 0) void load(''); }, [workspaceId, revision]);
  useEffect(() => {
    if (revision === 0) return;
    for (const path of Object.keys(open)) if (open[path] && path !== '') void load(path);
  }, [revision]);
  useEffect(() => {
    const parts = (target.kind === 'file' ? target.path.split('/').slice(0, -1) : target.path.split('/')).filter(Boolean);
    const dirs = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    for (const dir of dirs) {
      if (!open[dir]) setOpen((prev) => ({ ...prev, [dir]: true }));
      if (!children[dir] && revision > 0) void load(dir);
    }
  }, [target]);

  const toggle = (path: string) => {
    const next = !open[path];
    setOpen((prev) => ({ ...prev, [path]: next }));
    if (next && !children[path]) void load(path);
  };

  const render = (path: string, depth: number) => (children[path] ?? []).map((e) => {
    const selected = target.path === e.path;
    if (e.kind === 'dir') {
      const isOpen = !!open[e.path];
      return (
        <div key={e.path}>
          <button className={`tree-row ${selected && target.kind === 'folder' ? 'is-selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => { toggle(e.path); onNavigate({ kind: 'folder', path: e.path }); }}>
            {isOpen ? <ChevronDown size={13} className="t3" /> : <ChevronRight size={13} className="t3" />}
            <FolderGlyph size={16} />
            <span className="truncate">{e.name}</span>
          </button>
          {isOpen && render(e.path, depth + 1)}
        </div>
      );
    }
    return (
      <button key={e.path} className={`tree-row ${selected ? 'is-selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 + 17 }} onClick={() => onNavigate({ kind: 'file', path: e.path })}>
        <FileText size={14} className="t3" />
        <span className="truncate">{e.name}</span>
        {e.producedBy && <span className="status-dot done" title="任务产物" />}
      </button>
    );
  });

  return (
    <div className="tree">
      <button className={`tree-row ${target.kind === 'folder' && target.path === '' ? 'is-selected' : ''}`} onClick={() => onNavigate({ kind: 'folder', path: '' })}>
        <ChevronDown size={13} className="t3" /><FolderGlyph size={16} /><span className="truncate font-medium">{rootName}</span>
      </button>
      {render('', 1)}
    </div>
  );
}
