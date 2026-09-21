import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, MessageSquareText, PanelLeft, Plus, Search, X } from 'lucide-react';
import { DEFAULT_MODEL, forgetRecent, kimi, readRecent, type ContinuoDoc, type ContinuoTask, type Workspace } from '#/lib/api';
import { FolderGlyph } from './icons';

const TASK_DOT: Record<ContinuoTask['status'], string> = {
  queued: '', running: 'running', verifying: 'running', awaiting_user: 'waiting', needs_review: 'waiting', completed: '', paused: '', interrupted: 'failed', failed: 'failed',
};

export function Sidebar({ workspace, doc, collapsed, selectedTaskId, onToggle, onSelectTask, onSwitchWorkspace, onAddWorkspace, onNewTask, onSearch, onAbout }: {
  workspace: Workspace; doc: ContinuoDoc | null; collapsed: boolean; selectedTaskId: string | null;
  onToggle: () => void; onSelectTask: (task: ContinuoTask) => void; onSwitchWorkspace: (w: Workspace) => void; onAddWorkspace: () => void; onNewTask: () => void; onSearch: () => void; onAbout: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRecent(readRecent());
    kimi.workspaces().then((r) => { if (!cancelled) setWorkspaces(r.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspace.id]);
  const tasks = doc ? [...doc.tasks].toReversed() : [];
  const others = recent.filter((id) => id !== workspace.id).map((id) => workspaces.find((w) => w.id === id)).filter((w): w is Workspace => w !== undefined);
  const visible = showAll ? others : others.slice(0, 4);
  const forget = (id: string) => { forgetRecent(id); setRecent(readRecent()); };

  if (collapsed) {
    return (
      <aside className="pane pane-nav chrome" aria-label="导航">
        <div className="rail">
          <button className="btn btn-icon" title="展开侧栏" onClick={onToggle}><PanelLeft size={18} /></button>
          <button className="btn btn-icon" title="新任务 ⌘N" onClick={onNewTask}><Plus size={18} /></button>
          <button className="btn btn-icon" title="搜索 ⌘F" onClick={onSearch}><Search size={18} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="pane pane-nav chrome" aria-label="导航">
      <div className="side-top">
        <span className="brand"><span className="brand-mark" />Continuo</span>
        <span className="flex-1" />
        <button className="btn btn-icon" title="收起侧栏" onClick={onToggle}><PanelLeft size={18} /></button>
      </div>
      <div className="pane-body px-2 pb-3">
        <button className="side-row" onClick={onNewTask}><Plus size={16} className="ic" /><span className="flex-1">新任务</span><span className="kbd">⌘N</span></button>
        <button className="side-row" onClick={onSearch}><Search size={16} className="ic" /><span className="flex-1">搜索此文件夹</span><span className="kbd">⌘F</span></button>

        <div className="side-section"><span>工作空间</span><button className="btn btn-icon" style={{ width: 24, height: 24 }} title="打开别的文件夹" onClick={onAddWorkspace}><Plus size={14} /></button></div>
        <button className="side-row is-selected" title={workspace.root}>
          <FolderGlyph size={18} /><span className="flex-1 truncate font-medium">{workspace.name}</span><ChevronDown size={14} className="t3" />
        </button>
        <div className="py-1">
          {tasks.map((t) => (
            <button key={t.taskId} className={`side-sub ${t.taskId === selectedTaskId ? 'is-selected' : ''}`} onClick={() => onSelectTask(t)} title={t.title}>
              <MessageSquareText size={14} className="flex-none" />
              <span className="flex-1 truncate">{t.kind === 'init' ? '了解这个工作空间' : t.title}</span>
              {TASK_DOT[t.status] ? <span className={`status-dot ${TASK_DOT[t.status]}`} /> : <span className="t3 xs">{shortDate(t.createdAt)}</span>}
            </button>
          ))}
          {tasks.length === 0 && <div className="t3 xs" style={{ padding: '4px 10px 4px 34px' }}>还没有任务</div>}
        </div>
        {visible.map((w) => (
          <div key={w.id} className="side-row side-row-ws" title={w.root} onClick={() => onSwitchWorkspace(w)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSwitchWorkspace(w); }}>
            <FolderGlyph size={18} /><span className="flex-1 truncate">{w.name}</span>
            <button className="ws-forget" title="从列表移除（不删除文件）" onClick={(e) => { e.stopPropagation(); forget(w.id); }}><X size={13} /></button>
            <ChevronRight size={14} className="t3 ws-chev" />
          </div>
        ))}
        {others.length === 0 && <div className="t3 xs" style={{ padding: '6px 10px' }}>这里只列你在 Continuo 里打开过的文件夹</div>}
        {others.length > 4 && <button className="side-row t3 sm" style={{ justifyContent: 'center' }} onClick={() => setShowAll(!showAll)}>{showAll ? '收起' : `显示更多（${others.length - 4}）`}</button>}
      </div>
      <div className="side-footer">
        <span className="avatar">K</span>
        <div className="min-w-0 flex-1">
          <div className="truncate sm font-medium">Kimi 账号</div>
          <div className="t3 xs truncate">{DEFAULT_MODEL.split('/').pop()}{doc ? ` · 第 ${doc.openCount} 次打开` : ''}</div>
        </div>
        <button className="btn btn-icon" title="四个判断" onClick={onAbout}><HelpCircle size={18} /></button>
      </div>
    </aside>
  );
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
