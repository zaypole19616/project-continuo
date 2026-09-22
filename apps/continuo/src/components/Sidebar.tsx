import { useState } from 'react';
import { ChevronDown, CircleHelp, HelpCircle, MessageSquareText, PanelLeft, Plus, Search } from 'lucide-react';
import { DEFAULT_MODEL, type ContinuoDoc, type ContinuoTask, type Workspace } from '#/lib/api';
import { FolderGlyph } from './icons';
import { FolderMenu } from './FolderMenu';

const TASK_DOT: Record<ContinuoTask['status'], string> = {
  queued: '', running: 'running', verifying: 'running', awaiting_user: 'waiting', needs_review: 'waiting', completed: '', paused: '', interrupted: 'failed', failed: 'failed',
};

export function Sidebar({ workspace, doc, collapsed, selectedTaskId, onToggle, onSelectTask, onPickWorkspace, onNewTask, onSearch, onAbout, onGuide }: {
  workspace: Workspace | null; doc: ContinuoDoc | null; collapsed: boolean; selectedTaskId: string | null;
  onToggle: () => void; onSelectTask: (task: ContinuoTask) => void; onPickWorkspace: (w: Workspace) => void;
  onNewTask: () => void; onSearch: () => void; onAbout: () => void; onGuide: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const tasks = doc ? [...doc.tasks].toReversed() : [];

  if (collapsed) {
    return (
      <aside className="pane pane-nav chrome" aria-label="导航">
        <div className="rail">
          <button className="btn btn-icon" title="展开侧栏" onClick={onToggle}><PanelLeft size={18} /></button>
          {workspace && <button className="btn btn-icon" title="新对话 ⌘N" onClick={onNewTask}><Plus size={18} /></button>}
          {workspace && <button className="btn btn-icon" title="搜索 ⌘F" onClick={onSearch}><Search size={18} /></button>}
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
      <div className="px-2">
        <button className="side-row" onClick={onNewTask}><Plus size={16} className="ic" /><span className="flex-1">新对话</span><span className="kbd">⌘N</span></button>
        <div className="chip-anchor" style={{ display: 'block' }}>
          <button className="side-row side-folder" title={workspace?.root ?? '还没有选文件夹'} onClick={() => setPicking(!picking)}>
            <FolderGlyph size={18} /><span className="flex-1 truncate font-medium">{workspace?.name ?? '选择文件夹'}</span><ChevronDown size={14} className="t3" />
          </button>
          {picking && <FolderMenu currentId={workspace?.id} onPick={onPickWorkspace} onClose={() => setPicking(false)} />}
        </div>
      </div>
      <div className="pane-body px-2 pb-3">
        <div className="side-section"><span>对话</span></div>
        {tasks.map((t) => (
          <button key={t.taskId} className={`side-sub ${t.taskId === selectedTaskId ? 'is-selected' : ''}`} onClick={() => onSelectTask(t)} title={t.title}>
            <MessageSquareText size={14} className="flex-none" />
            <span className="flex-1 truncate">{t.kind === 'init' ? '了解这个文件夹' : t.title}</span>
            {TASK_DOT[t.status] ? <span className={`status-dot ${TASK_DOT[t.status]}`} /> : <span className="t3 xs">{shortDate(t.createdAt)}</span>}
          </button>
        ))}
        {tasks.length === 0 && <div className="t3 xs" style={{ padding: '4px 10px' }}>{workspace ? '还没有对话' : '选一个文件夹就可以开始'}</div>}
      </div>
      <div className="px-2 pb-1"><button className="side-row" onClick={onGuide}><CircleHelp size={16} className="ic" /><span className="flex-1">使用引导</span></button></div>
      <div className="side-footer">
        <span className="avatar">K</span>
        <div className="min-w-0 flex-1">
          <div className="truncate sm font-medium">Kimi 账号</div>
          <div className="t3 xs truncate">基于 Kimi Code · {DEFAULT_MODEL.split('/').pop()}{doc ? ` · 第 ${doc.openCount} 次打开` : ''}</div>
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
