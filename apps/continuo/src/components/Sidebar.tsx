import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, MessageSquareText, PanelLeft, Plus, Search, Sparkles } from 'lucide-react';
import { DEFAULT_MODEL, kimi, type ContinuoDoc, type ContinuoTask, type Workspace } from '#/lib/api';

const TASK_DOT: Record<ContinuoTask['status'], string> = {
  queued: '', running: 'running', verifying: 'running', awaiting_user: 'waiting', needs_review: 'waiting', completed: '', paused: '', interrupted: 'failed', failed: 'failed',
};

export function Sidebar({ workspace, doc, collapsed, selectedTaskId, onToggle, onSelectTask, onSwitchWorkspace, onAddWorkspace, onNewTask, onSearch }: {
  workspace: Workspace; doc: ContinuoDoc | null; collapsed: boolean; selectedTaskId: string | null;
  onToggle: () => void; onSelectTask: (task: ContinuoTask) => void; onSwitchWorkspace: (w: Workspace) => void; onAddWorkspace: () => void; onNewTask: () => void; onSearch: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let cancelled = false;
    kimi.workspaces().then((r) => { if (!cancelled) setWorkspaces(r.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspace.id]);
  const tasks = doc ? [...doc.tasks].toReversed() : [];
  const visibleWorkspaces = showAll ? workspaces : workspaces.slice(0, 5);

  if (collapsed) {
    return (
      <aside className="pane pane-nav chrome" aria-label="导航">
        <div className="rail">
          <button className="btn btn-icon" title="展开侧栏" onClick={onToggle}><PanelLeft size={18} /></button>
          <button className="btn btn-icon" title="新任务" onClick={onNewTask}><Plus size={18} /></button>
          <button className="btn btn-icon" title="搜索" onClick={onSearch}><Search size={18} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="pane pane-nav chrome" aria-label="导航">
      <div className="side-top">
        <span className="flex-1" />
        <button className="btn btn-icon" title="搜索此文件夹" onClick={onSearch}><Search size={18} /></button>
        <button className="btn btn-icon" title="收起侧栏" onClick={onToggle}><PanelLeft size={18} /></button>
      </div>
      <div className="side-brand">
        <span className="brand-mark" />
        <span className="brand-name">Continuo</span>
        <button className="brand-ws" title={workspace.root}><span className="truncate">{workspace.name}</span><ChevronDown size={14} /></button>
      </div>
      <div className="pane-body px-3 pb-3">
        <button className="side-row side-row-primary" onClick={onNewTask}><Plus size={16} /><span className="flex-1 text-left">新任务</span><span className="kbd">⌘N</span></button>
        <button className="side-row" disabled title="即将支持"><Sparkles size={16} style={{ color: '#c9a227' }} /><span className="flex-1 text-left">技能 · 连接器</span></button>

        <div className="side-section"><span>工作空间</span><button className="btn btn-icon btn-sm" title="打开别的文件夹" onClick={onAddWorkspace}><Plus size={16} /></button></div>
        {visibleWorkspaces.map((w) => (
          <button key={w.id} className={`side-row ${w.id === workspace.id ? 'is-selected' : ''}`} onClick={() => onSwitchWorkspace(w)} title={w.root}>
            <span className="mini-folder" style={{ background: w.id === workspace.id ? '#3f8fe0' : '#f0b64a' }} />
            <span className="flex-1 text-left truncate">{w.name}</span>
          </button>
        ))}
        {workspaces.length > 5 && (
          <button className="side-row side-row-more" onClick={() => setShowAll(!showAll)}>{showAll ? <><span>收起</span><ChevronUp size={14} /></> : <><span>显示更多</span><ChevronDown size={14} /></>}</button>
        )}

        <div className="side-section"><span>任务记录</span></div>
        {tasks.map((t) => (
          <button key={t.taskId} className={`side-row ${t.taskId === selectedTaskId ? 'is-selected' : ''}`} onClick={() => onSelectTask(t)} title={t.title}>
            <MessageSquareText size={16} className="text-3" />
            <span className="flex-1 text-left truncate">{t.kind === 'init' ? '了解这个工作空间' : t.title}</span>
            {TASK_DOT[t.status] ? <span className={`status-dot ${TASK_DOT[t.status]}`} /> : <span className="text-3 fs-meta">{shortDate(t.createdAt)}</span>}
          </button>
        ))}
        {tasks.length === 0 && <div className="text-3 fs-meta px-3 py-2">还没有任务</div>}
      </div>
      <div className="side-footer">
        <span className="avatar">K</span>
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 'var(--fs-body)', fontWeight: 500 }}>Kimi 账号</div>
          <div className="text-3 fs-meta truncate">{DEFAULT_MODEL.split('/').pop()}{doc ? ` · 第 ${doc.openCount} 次打开` : ''}</div>
        </div>
        <ChevronsUpDown size={16} className="text-3" />
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
