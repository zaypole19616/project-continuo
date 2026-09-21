import { useEffect, useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Plus, Sparkles } from 'lucide-react';
import { continuoFiles, type ContinuoDoc, type ContinuoTask, type FileEntry, type Workspace } from '#/lib/api';

export type NavTarget = { kind: 'folder'; path: string } | { kind: 'file'; path: string };

const TASK_DOT: Record<ContinuoTask['status'], string> = {
  queued: '', running: 'running', verifying: 'running', awaiting_user: 'waiting', needs_review: 'waiting', completed: 'done', paused: '', interrupted: 'failed', failed: 'failed',
};

export function Sidebar({ workspace, doc, collapsed, selectedTaskId, currentPath, onToggle, onNavigate, onSelectTask, onSwitchWorkspace, onNewTask }: {
  workspace: Workspace; doc: ContinuoDoc | null; collapsed: boolean; selectedTaskId: string | null; currentPath: string;
  onToggle: () => void; onNavigate: (target: NavTarget) => void; onSelectTask: (task: ContinuoTask) => void; onSwitchWorkspace: () => void; onNewTask: () => void;
}) {
  const tasks = doc ? [...doc.tasks].toReversed() : [];
  if (collapsed) {
    return (
      <aside className="pane pane-nav chrome" aria-label="导航">
        <div className="pane-header justify-center" style={{ padding: 0 }}>
          <button className="btn btn-icon" title="展开侧栏" onClick={onToggle}><PanelLeftOpen size={18} /></button>
        </div>
        <div className="flex flex-col items-center gap-2 p-2">
          <button className="btn btn-icon" title={workspace.name} onClick={() => onNavigate({ kind: 'folder', path: '' })}><FolderOpen size={18} /></button>
          <button className="btn btn-icon" title="新任务" onClick={onNewTask}><Plus size={18} /></button>
          <button className="btn btn-icon" title="换文件夹" onClick={onSwitchWorkspace}><Sparkles size={18} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="pane pane-nav chrome" aria-label="导航">
      <div className="pane-header">
        <button className="row row-click flex-1 min-w-0" style={{ padding: '0 6px' }} onClick={onSwitchWorkspace} title={workspace.root}>
          <FolderOpen size={16} className="text-2" />
          <span className="truncate font-medium">{workspace.name}</span>
          <ChevronRight size={14} className="text-3" />
        </button>
        <button className="btn btn-icon" title="收起侧栏" onClick={onToggle}><PanelLeftClose size={18} /></button>
      </div>
      <div className="pane-body p-2 space-y-4">
        <section>
          <div className="nav-section flex items-center justify-between"><span>文件</span>{doc?.scan && <span>{doc.scan.counts.files} 个</span>}</div>
          <FolderTree workspaceId={workspace.id} revision={doc?.revision ?? 0} currentPath={currentPath} onNavigate={onNavigate} />
        </section>
        <section>
          <div className="nav-section flex items-center justify-between">
            <span>任务</span>
            <button className="btn btn-sm btn-ghost" style={{ height: 22, padding: '0 6px' }} onClick={onNewTask}><Plus size={14} />新任务</button>
          </div>
          <div className="space-y-0.5">
            {tasks.map((t) => (
              <button key={t.taskId} className={`row row-click w-full text-left ${t.taskId === selectedTaskId ? 'is-selected' : ''}`} onClick={() => onSelectTask(t)} title={t.title}>
                <span className={`status-dot ${TASK_DOT[t.status]}`} />
                <span className="truncate flex-1" style={{ fontSize: 'var(--fs-body)' }}>{t.kind === 'init' ? '了解这个工作空间' : t.title}</span>
              </button>
            ))}
            {tasks.length === 0 && <div className="text-3 fs-meta px-2 py-1">还没有任务</div>}
          </div>
        </section>
      </div>
      <div className="p-3 border-t fs-meta text-3" style={{ borderColor: 'var(--divider)' }}>
        {doc ? `第 ${doc.openCount} 次打开 · 有效 context ${doc.context.filter((e) => e.status === 'active').length} 条` : '打开中…'}
      </div>
    </aside>
  );
}

function FolderTree({ workspaceId, revision, currentPath, onNavigate }: { workspaceId: string; revision: number; currentPath: string; onNavigate: (target: NavTarget) => void }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [open, setOpen] = useState<Record<string, FileEntry[]>>({});
  useEffect(() => {
    let cancelled = false;
    continuoFiles.list(workspaceId, '').then((r) => { if (!cancelled) setEntries(r.entries); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceId, revision]);
  useEffect(() => {
    for (const path of Object.keys(open)) {
      continuoFiles.list(workspaceId, path).then((r) => setOpen((prev) => (path in prev ? { ...prev, [path]: r.entries } : prev))).catch(() => undefined);
    }
  }, [workspaceId, revision]);
  useEffect(() => {
    const parts = currentPath.split('/').filter(Boolean);
    const dirs = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    for (const dir of dirs) {
      if (dir in open) continue;
      continuoFiles.list(workspaceId, dir).then((r) => setOpen((prev) => (dir in prev ? prev : { ...prev, [dir]: r.entries }))).catch(() => undefined);
    }
  }, [workspaceId, currentPath]);
  const toggle = (entry: FileEntry) => {
    if (entry.path in open) { const next = { ...open }; delete next[entry.path]; setOpen(next); return; }
    continuoFiles.list(workspaceId, entry.path).then((r) => setOpen((prev) => ({ ...prev, [entry.path]: r.entries }))).catch(() => undefined);
  };
  const render = (list: FileEntry[], depth: number) => list.map((entry) => (
    <div key={entry.path}>
      <button className={`row row-click w-full text-left ${currentPath === entry.path ? 'is-selected' : ''}`} style={{ minHeight: 32, paddingLeft: 10 + depth * 14 }} onClick={() => { if (entry.kind === 'dir') { toggle(entry); onNavigate({ kind: 'folder', path: entry.path }); } else onNavigate({ kind: 'file', path: entry.path }); }}>
        {entry.kind === 'dir' ? (entry.path in open ? <FolderOpen size={15} className="text-2" /> : <Folder size={15} className="text-2" />) : <FileText size={15} className="text-3" />}
        <span className="truncate flex-1">{entry.name}</span>
        {entry.producedBy && <span className="status-dot done" title="任务产物" />}
      </button>
      {entry.kind === 'dir' && open[entry.path] && render(open[entry.path] ?? [], depth + 1)}
    </div>
  ));
  return <div className="space-y-0.5">{render(entries, 0)}{entries.length === 0 && <div className="text-3 fs-meta px-2 py-1">空文件夹</div>}</div>;
}
