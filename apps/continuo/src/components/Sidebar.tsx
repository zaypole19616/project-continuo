import { useEffect, useState } from 'react';
import { ChevronRight, CircleHelp, Folder, FolderOpen, PanelLeft, Plus, Search, SquarePen } from 'lucide-react';
import { continuo, DEFAULT_MODEL, type ContinuoDoc, type ContinuoTask, type Workspace } from '#/lib/api';
import { FolderMenu } from './FolderMenu';
import { Button } from '#/components/ui/button';

const TASK_DOT: Record<ContinuoTask['status'], string> = {
  queued: '', running: 'running', verifying: 'running', awaiting_user: 'waiting', needs_review: 'waiting', completed: '', paused: '', interrupted: 'failed', failed: 'failed',
};

export function Sidebar({ workspace, doc, workspaces, collapsed, selectedTaskId, onToggle, onSelectTask, onPickWorkspace, onNewTask, onSearch, onGuide }: {
  workspace: Workspace | null; doc: ContinuoDoc | null; workspaces: Workspace[]; collapsed: boolean; selectedTaskId: string | null;
  onToggle: () => void; onSelectTask: (task: ContinuoTask) => void; onPickWorkspace: (w: Workspace) => void;
  onNewTask: () => void; onSearch: () => void; onGuide: () => void;
}) {
  const [folded, setFolded] = useState<Record<string, boolean>>(() => readFolded());
  const tasks = doc ? doc.tasks.filter((t) => t.kind === 'user').toReversed() : [];
  const toggle = (id: string) => setFolded((current) => { const next = { ...current, [id]: !current[id] }; writeFolded(next); return next; });

  if (collapsed) {
    return (
      <aside className="pane pane-nav chrome" aria-label="导航">
        <div className="rail">
          <Button variant="ghost" size="icon" title="展开侧栏" onClick={onToggle}><PanelLeft size={18} /></Button>
          {workspace && <Button variant="ghost" size="icon" title="新会话 ⌘N" onClick={onNewTask}><SquarePen size={18} /></Button>}
          {workspace && <Button variant="ghost" size="icon" title="搜索 ⌘F" onClick={onSearch}><Search size={18} /></Button>}
        </div>
      </aside>
    );
  }
  return (
    <aside className="pane pane-nav chrome" aria-label="导航">
      <div className="side-top">
        <span className="brand"><span className="brand-mark" />Continuo</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" title="收起侧栏" onClick={onToggle}><PanelLeft size={18} /></Button>
      </div>
      <div className="px-2">
        <button className="side-row" onClick={onNewTask}><SquarePen size={16} className="ic" /><span className="flex-1">新会话</span><span className="kbd">⌘N</span></button>
        <button className="side-row" onClick={onSearch}><Search size={16} className="ic" /><span className="flex-1">搜索</span></button>
      </div>
      <div className="pane-body px-2 pb-3">
        <div className="side-section">
          <span>会话</span>
          <FolderMenu
            currentId={workspace?.id}
            onPick={onPickWorkspace}
            trigger={<Button variant="ghost" size="icon-sm" className="size-5.5" title="添加文件夹"><Plus className="size-3.5" /></Button>}
          />
        </div>
        {workspaces.map((w) => (
          <FolderGroup
            key={w.id} workspace={w} current={w.id === workspace?.id} tasks={w.id === workspace?.id ? tasks : undefined}
            open={!folded[w.id]} selectedTaskId={selectedTaskId}
            onToggle={() => toggle(w.id)} onOpen={() => onPickWorkspace(w)} onSelectTask={onSelectTask}
          />
        ))}
        {workspaces.length === 0 && <div className="side-empty" style={{ paddingLeft: 9 }}>还没有文件夹</div>}
      </div>
      <div className="px-2 pb-1"><button className="side-row" onClick={onGuide}><CircleHelp size={16} className="ic" /><span className="flex-1">使用引导</span></button></div>
      <div className="side-footer">
        <span className="avatar">K</span>
        <div className="min-w-0 flex-1">
          <div className="truncate sm font-medium">Kimi 账号</div>
          <div className="t3 xs truncate">基于 Kimi Code · {DEFAULT_MODEL.split('/').pop()}</div>
        </div>
      </div>
    </aside>
  );
}

const FOLDED_KEY = 'continuo.folders.collapsed';
function readFolded(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}
function writeFolded(value: Record<string, boolean>) {
  try { localStorage.setItem(FOLDED_KEY, JSON.stringify(value)); } catch {}
}

function FolderGroup({ workspace, current, tasks, open, selectedTaskId, onToggle, onOpen, onSelectTask }: {
  workspace: Workspace; current: boolean; tasks?: ContinuoTask[]; open: boolean; selectedTaskId: string | null;
  onToggle: () => void; onOpen: () => void; onSelectTask: (task: ContinuoTask) => void;
}) {
  const [fetched, setFetched] = useState<ContinuoTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || current || fetched !== null) return;
    let cancelled = false;
    setLoading(true);
    continuo.get(workspace.id)
      .then((d) => { if (!cancelled) setFetched(d.tasks.filter((t) => t.kind === 'user').toReversed()); })
      .catch(() => { if (!cancelled) setFetched([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, current, fetched, workspace.id]);
  const list = tasks ?? fetched;
  return (
    <div className="side-group">
      <div className={`side-folder-row ${current ? 'is-current' : ''}`} title={workspace.root}>
        <button className="side-fold" aria-label={open ? '收起' : '展开'} aria-expanded={open} onClick={onToggle}><ChevronRight size={13} className={open ? 'is-open' : ''} /></button>
        <button className="side-folder-name" onClick={onOpen}>
          {current ? <FolderOpen size={15} className="ic" /> : <Folder size={15} className="ic" />}
          <span className="flex-1 truncate">{workspace.name}</span>
        </button>
      </div>
      {open && list?.map((t) => (
        <button key={t.taskId} className={`side-sub ${current && t.taskId === selectedTaskId ? 'is-selected' : ''}`} onClick={() => { if (!current) onOpen(); else onSelectTask(t); }} title={t.title}>
          <span className="flex-1 truncate">{t.title}</span>
          {TASK_DOT[t.status] ? <span className={`status-dot ${TASK_DOT[t.status]}`} /> : <span className="t3 xs">{shortDate(t.createdAt)}</span>}
        </button>
      ))}
      {open && (loading ? <div className="side-empty">读取中…</div> : list?.length === 0 && <div className="side-empty">还没有会话</div>)}
    </div>
  );
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
